/// <reference path="../typings/index.d.ts" />

/**
 * Copyright 2016 Stephane M. Catala
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *  http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * Limitations under the License.
 */
;
import debug = require('debug')
const log = debug('worker-proxy')
import Promise = require('bluebird')
import {
  WorkerServiceEvent,
  WorkerServiceEventData,
  WorkerServiceMethodCall
} from './'
/**
 * @public
 * @interface ServiceBinder function that hooks a Service with a `Worker`
 * so that the Service can be proxied from the main thread.
 * @param {ServiceBinderSpec<S>}
 * @generic {S extends Object} type of Service
 */
export interface ServiceBinder {
  <S extends Object>(spec: ServiceBinderSpec<S>): void
}

/**
 * @public
 * @interface ServiceBinderSpec
 * @generic {S extends Object} type of Service
 * @prop {WorkerGlobalScope} self target `Worker`
 * @prop {S extends Object} service
 * @prop {() => Promise<void>} onterminate `terminate` event handler
 */
export interface ServiceBinderSpec<S extends Object> {
  /**
   * @public
   * @prop {WorkerGlobalScope} worker target `Worker`
   * (`self` in {WorkerGlobalScope})
   */
  worker: WorkerGlobalScope
  /**
   * @public
   * @prop {S extends Object} service
   */
  service: S
  /**
   * @public
   * @prop {() => Promise<void>} onterminate `terminate` event handler.
   * the returned Promise will be resolved or rejected in the main thread,
   * allowing the latter to to handle failure of service shut-down
   * before eventually forcing the `Worker` to terminate.
   */
  onterminate: () => Promise<void>
}

/**
 * @private
 * @class WorkerServiceClass
 */
class WorkerServiceClass<S extends Object> {
	/**
   * @public
   * @see {ServiceBinder}
	 */
	static hookService: ServiceBinder =
  function <S extends Object>(spec: ServiceBinderSpec<S>) {
  	const workerService = new WorkerServiceClass(spec)
  }
	/**
   * @private
   * @constructor
	 * @param {ServiceBinderSpec<S>} { worker, service, onterminate }
	 */
	constructor ({ worker, service, onterminate }: ServiceBinderSpec<S>) {
    this.worker = worker
    this.worker.onmessage = this.onmessage.bind(this) // hook
		log('worker.onmessage', 'hooked')
    this.onterminate = onterminate
    this.service = service
    this.methods = getPropertyNames(service || {})
    .filter(val => isFunction(service[val]))
    log('WorkerService.methods', this.methods)
  }
	/**
   * @private
   * @method onmessage `message` event handler.
   * call the target method as specified in `event.data`
	 * @param  {WorkerServiceEvent} event
	 */
	onmessage (event: WorkerServiceEvent): void {
    const { uuid, target, method, args } = event.data
    const targetMethod = (this[target]||this)[method]||this.unknown
    log('WorkerService.onmessage.targetMethod', targetMethod)
  	Promise.try(() => targetMethod.apply(this, args)) // manage errors from service
    .then(this.resolve.bind(this, uuid))
    .catch(this.reject.bind(this, uuid))
  }
  /**
   * @private
   * @method getServiceMethods
   * @returns {string[]} list of service methods
   */
  getServiceMethods (): string[] {
  	log('WorkerService.getServiceProxy', this.methods)
   	return this.methods
  }
  /**
   * @private
   * @method resolve call in main thread.
   * @param  {number} uuid call identifier
   * @param  {any} res resolve value
   */
  resolve (uuid: number, res: any) {
  	log('WorkerService.resolve', res)
    this.worker.postMessage({	method: 'resolve', args: [ uuid, res ] })
  }
  /**
   * @private
   * @method reject call in main thread.
   * @param  {number} uuid call identifier
   * @param  {Error} err
   */
  reject (uuid: number, err: Error) {
  	log('WorkerService.reject', err)
    this.worker.postMessage({
    	method: 'reject',
      args: [ uuid, {
        name: err.name,
        message: err.message,
        stack: err.stack
      } ]
    })
  }
  /**
   * @private
   * @method unknown
   * @error {Error} `unknown method`
   */
  unknown (): Promise<void> {
    return Promise.reject(new Error('unknown method'))
  }
  /**
   * @private
   * @method onterminate `terminate` handler
   * @see {ServiceBinderSpec#onterminate}
   */
  onterminate: () => Promise<void>
  /**
   * @private
   * @prop {WorkerGlobalScope} worker
   * @see {ServiceBinderSpec#worker}
   */
  worker: WorkerGlobalScope
  /**
   * @private
   * @prop {S} service
   * @see {ServiceBinderSpec#service}
   */
  service: S
  /**
   * @private
   * @prop {string[]} methods list of service methods
   */
  methods: string[]
}

/**
 * @private
 * @function
 * @param  {Object} obj
 * @return {string[]} list of property names excluding `constructor`
 * on `obj` and its prototype chain excluding `Object`
 */
function getPropertyNames (obj: Object): string[] {
	if (!obj || (typeof obj !== 'object') || Array.isArray(obj)) { return [] }

  const keys = Object.getOwnPropertyNames(obj)
  .filter(key => key !== 'constructor')
  .reduce((keys, key) => (keys[key] = true) && keys, this || {})

	const proto = Object.getPrototypeOf(obj)
	return (!proto || (proto.constructor === Object)) ?
  Object.getOwnPropertyNames(keys) : getPropertyNames.call(keys, proto)
}

/**
 * @private
 * @param  {any} val
 * @returns {val is Function}
 */
function isFunction (val: any): val is Function {
  return typeof val === 'function'
}

const hookService: ServiceBinder = WorkerServiceClass.hookService
export default hookService