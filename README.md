# worker-proxy [![Join the chat at https://gitter.im/ZenyWay/worker-proxy](https://badges.gitter.im/ZenyWay/worker-proxy.svg)](https://gitter.im/ZenyWay/worker-proxy?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![NPM](https://nodei.co/npm/worker-proxy.png?compact=true)](https://nodei.co/npm/worker-proxy/)
[![build status](https://travis-ci.org/ZenyWay/worker-proxy.svg?branch=master)](https://travis-ci.org/ZenyWay/worker-proxy)
[![coverage status](https://coveralls.io/repos/github/ZenyWay/worker-proxy/badge.svg?branch=master)](https://coveralls.io/github/ZenyWay/worker-proxy)
[![Dependency Status](https://gemnasium.com/badges/github.com/ZenyWay/worker-proxy.svg)](https://gemnasium.com/github.com/ZenyWay/worker-proxy)

spawn a service in a Web Worker and proxy it from the current thread

the proxy's `service` property resolves to a service object
with the same interface as that of the original service
running in the `Worker` thread.
only methods of the service object and its prototype chain
are proxied (not all properties).

the proxy exposes a `terminate` method that allows
to properly shut down the service
through a `onterminate` handler in the `Worker` thread
before definitively terminating the `Worker`.

# <a name="api"></a> API v2.1 stable
`ES5` and [`Typescript`](http://www.typescriptlang.org/) compatible.
Coded in `Typescript 2`.

## specs
run the [unit tests](https://cdn.rawgit.com/ZenyWay/worker-proxy/v2.1.4/spec/web/index.html)
in your browser.

## example
a live version of this example can be viewed [here](https://cdn.rawgit.com/ZenyWay/worker-proxy/v2.1.4/spec/example/index.html)
in the browser console,
or by cloning this repository and running the following commands from a terminal:
```bash
npm install
npm run example
```
the files of this example are available [here](./spec/example).

### module: `my-service`
sample third-party service module that we want to spawn in a dedicated Worker
and proxy in the main thread.
the service module is not part of the `worker-proxy` module.

```ts
/**
 * this is the service that will be spawned in a Worker thread
 * and that will be proxied in the main thread.
 * in this example, the service is created by a factory,
 * and it exposes both sync and async (Promise-returning) methods
 * for illustration purposes.
 * it expects to be shut down by calling its async `stop` method.
 */
export interface Service {
  toUpperCase (text: string): string // say this converts text to upper case
  anotherMethod (arg: any): any // any other service method
  stop (): Promise<void> // say this must be called to shut down the service
}

export interface ServiceFactory {
  (spec?: Object): Promise<Service>
}

const newService: ServiceFactory // = ... implementation left out
export default newService
```

### file: `worker.ts` (`WorkerGlobalScope`)
this script will be spawned from the main thread in a dedicated `Worker` thread.
it creates and initializes the service from the `my-service` module,
and then hooks it up so that it can be proxied from the main thread.
In doing so, it defines an `onterminate` handler
that will be called when the proxy is terminated in the main thread
and that allows to properly shut down the service
before the `Worker` is terminated.

The `onterminate` handler may return a `Promise`
that will be resolved or rejected in the main thread,
allowing the latter to handle failure of service shut-down
before eventually forcing the `Worker` to terminate.

```ts
import hookService from 'worker-proxy/dist/worker'
import newService from 'my-service'

// create and initialize the service
const spec = { /* service configuration options */ }
const service = newService(spec) // Promise<Service>

// define an `onterminate` handler to properly shut down the service
// before this Worker is terminated.
// the return value will be sent back to the main thread.
function onterminate () {
  return service
  .then(service => service.stop()) // resolve or reject back to main thread
}

// hook up the service so it can be proxied from the main thread
// and wait until the proxy's terminate method is called in the main thread
service
.then(service => hookService({
  worker: self,
  service: service,
  onterminate: onterminate
}))
```

> NOTE: the above approach requires prior bundling of dependencies
> into the worker code, e.g. with [`browserify`](http://browserify.org/).
> [see below](#webworkify) for a
> [`webworkify`](https://www.npmjs.com/package/webworkify)-like
> example, allowing the worker-script to `require` its dependencies 'live'.

since npm version `2.1.0` (API 1.1) it is additionally possible to restrict
the proxied service methods to a subset of the original service methods:
```ts
service
.then(service => hookService({
  worker: self,
  service: service,
  methods: [ 'toUpperCase', 'stop' ], // only expose service#toUpperCase and service#stop
  onterminate: onterminate
}))
```

### file: index.ts
this script runs in the main thread.
it spawns the `worker.ts` script in a dedicated Worker thread
and proxies it in the main thread.

the resulting proxy resolves to a service object with the same interface
as that of the original service running in the Worker thread.
note that in its current implementation, only enumerable methods of the service
are proxied.

to shut down the service and terminate the Worker,
the proxy's `terminate` method can be called as in this example.

```ts
import newServiceProxy from 'worker-proxy/dist/proxy'
import { Service } from 'my-service' // only import the interface for casting
const log = console.log.bind(console)

// proxy and spawn the Worker
const proxy = newServiceProxy<Service>('worker.ts')
const terminate = proxy.terminate.bind(proxy)

// unwrap the Promise to access the proxied service
proxy.service
.call('toUpperCase', 'Rob says wow!') // or .then(service => service.toUpperCase('Rob says wow!'))
.tap(log) // "ROB SAYS WOW!"
.then(terminate) // shut down service and terminate Worker
.catch(err => log(err) || proxy.kill()) // log shutdown error and force Worker termination
```

note that using the `Service` interface as type for the proxied service object
is not strictly correct, since all methods of the latter are asynchronous,
i.e. return a `Promise`, while some methods of the `Service` instance
running in the worker are synchronous. However, in the context of the above
example, the approximation is not relevant.

## <a name="webworkify"></a> `require` in worker script
the above approach requires prior bundling of dependencies
into the worker code, e.g. with [`browserify`](http://browserify.org/).
this typically results in unnecessarily bloating the code
because bundles are generated both for the main script and the worker script,
and common dependencies are bundled in both.

`worker-proxy` builds on [`webworkify`](https://www.npmjs.com/package/webworkify)
to optionally spawn a `Worker` that can `require` its dependencies 'live':
both the main and worker scripts can be bundled together
with [`browserify`](http://browserify.org/),
together with all required dependencies.

to enable this, the main script should `require` the worker script,
which should export its code as a function taking a single argument,
`self`, without any return value.

the main and worker scripts from the above example are modified accordingly
for illustration:

### file: `worker.ts` (`WorkerGlobalScope`)
to enable 'live' `require` calls from the worker thread,
simply wrap its code into a function that takes a single argument (self),
and export that function:

```ts
import hookService from 'worker-proxy/dist/worker'
import newService from 'my-service'

export = function (self) {
  // create and initialize the service
  const spec = { /* service configuration options */ }
  const service = newService(spec) // Promise<Service>

  // define an `onterminate` handler to properly shut down the service
  // before this Worker is terminated.
  // the return value will be sent back to the main thread.
  function onterminate () {
    return service
    .then(service => service.stop()) // resolve or reject back to main thread
  }

  // hook up the service so it can be proxied from the main thread
  // and wait until the proxy's terminate method is called in the main thread
  service
  .then(service => hookService({
    worker: self,
    service: service,
    onterminate: onterminate
  }))
}
```

### file: index.ts
to enable 'live' `require` calls from the worker thread,
simply `require` the worker script in the main script:

```ts
import worker = require('./worker')
import newServiceProxy from 'worker-proxy/dist/proxy'
import { Service } from 'my-service' // only import the interface for casting
const log = console.log.bind(console)

// proxy and spawn the Worker
const proxy = newServiceProxy<Service>(worker)
const terminate = proxy.terminate.bind(proxy)

// unwrap the Promise to access the proxied service
proxy.service
.call('toUpperCase', 'Rob says wow!') // or .then(service => service.toUpperCase('Rob says wow!'))
.tap(log) // "ROB SAYS WOW!"
.then(terminate) // shut down service and terminate Worker
.catch(err => log(err) || proxy.kill()) // log shutdown error and force Worker termination
```

### other example
another webworkify-based example can be found
[in this gist](https://gist.github.com/smcatala/bee0f411b08ec45933cb69264812a62e),
and demonstrates how to spawn [opgp-service](https://github.com/ZenyWay/opgp-service)
in a worker, with the main-thread proxy, the spawned service and
all their dependencies all bundled in a single file.

# <a name="contributing"></a> CONTRIBUTING
see the [contribution guidelines](./CONTRIBUTING.md)

# <a name="license"></a> LICENSE
Copyright 2016 Stéphane M. Catala

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the [License](./LICENSE) for the specific language governing permissions and
Limitations under the License.
