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
import {
  WorkerServiceEvent,
  IndexedMethodCallSpec
} from '../common/interfaces'

import { assert, isObject, isFunction, isArrayLike, isString }
from '../common/utils'

import Promise = require('bluebird')

import debug = require('debug')
const log = debug('worker-proxy')
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
 * @prop {DedicatedWorkerGlobalScope} self target `Worker`
 * @prop {S extends Object} service
 * @prop {() => Promise<void>} onterminate `terminate` event handler
 */
export interface ServiceBinderSpec<S extends Object> {
  /**
   * no type checking to facilitate import from client-code with dom types
   * @public
   * @prop {DedicatedWorkerGlobalScope} worker target `Worker`
   * (`self` in {DedicatedWorkerGlobalScope})
   */
  worker: any // DedicatedWorkerGlobalScope
  /**
   * @public
   * @prop {S extends Object} service?
   */
  service: S
  /**
   * @public
   * @prop {() => Promise<void>} onterminate? `terminate` event handler.
   * the returned Promise will be resolved or rejected in the main thread,
   * allowing the latter to to handle failure of service shut-down
   * before eventually forcing the `Worker` to terminate.
   */
  onterminate?: () => (void | Promise<void>)
  /**
   * @public
   * @prop {string[]=} methods
   * expose only the service methods in this list,
   * or all service methods if `undefined`.
   */
  methods?: string[]
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
    assert(isValidServiceBinderSpec(spec), TypeError, 'invalid argument')
    const config: ServiceBinderSpec<S> = { ...spec }
    config.methods = getPropertyNames(spec.service)
    .filter(val =>
      isFunction(spec.service[val]))
    .filter(val =>
      !spec.methods || (spec.methods.indexOf(val) >= 0))
  	const workerService = new WorkerServiceClass(config)
  }
	/**
   * @private
   * @constructor
	 * @param {ServiceBinderSpec<S>} { worker, service, onterminate }
	 */
	constructor ({ worker, service, onterminate, methods }: ServiceBinderSpec<S>) {
    this.worker = worker
    worker.onmessage = this.onmessage.bind(this) // hook
		log('worker.onmessage', 'hooked')
    this.onterminate = onterminate
    this.service = service
    this.methods = methods
    log('WorkerService.methods', this.methods)
  }
	/**
   * @private
   * @method onmessage `message` event handler.
   * call the target method as specified in `event.data`
	 * @param  {WorkerServiceEvent} event
	 */
	onmessage (event: WorkerServiceEvent): void {
  	Promise.try(() => this.callTargetMethod(event.data)) // catch and reject exceptions
    .then(this.resolve.bind(this, event.data.uuid))
    .catch(this.reject.bind(this, event.data.uuid))
  }
  /**
   * @private
   * @method call target method as specified.
   * @param {MethodCallSpec} spec
   * @return {Promise<any>} result from target method call
   * @error {Error} from target method call
   * @error {Error} "invalid argument" when `spec` is invalid
   */
  callTargetMethod (spec: IndexedMethodCallSpec): Promise<any> {
    assert(Number.isSafeInteger(spec.uuid), TypeError, "invalid argument")
    assert(isValidWorkerServiceMethodCall(spec), TypeError, "invalid argument")
    const target = isObject(this[spec.target]) ? this[spec.target] : this
    const isValidMethod = target !== this.service
    ? isFunction(target[spec.method]) : this.methods.indexOf(spec.method) >= 0
    const method = isValidMethod ? target[spec.method] : this.unknown
    return method.apply(target, spec.args || [])
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
    this.worker.postMessage({	uuid: uuid, method: 'resolve', args: [ res ] })
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
      uuid: uuid,
    	method: 'reject',
      args: [ {
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
  onterminate: () => (void | Promise<void>)
  /**
   * @private
   * @prop {DedicatedWorkerGlobalScope} worker
   * @see {ServiceBinderSpec#worker}
   */
  worker: DedicatedWorkerGlobalScope
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
  const keys = Object.getOwnPropertyNames(obj)
  .filter(key => key !== 'constructor')
  .reduce((keys, key) => (keys[key] = true) && keys, this || {})

	const proto = Object.getPrototypeOf(obj)
	return isObjectPrototype(proto) ?
  Object.getOwnPropertyNames(keys) : getPropertyNames.call(keys, proto)
}
/**
 * @private
 * @function isValidServiceBinderSpec
 * @param {any} val
 * @return {val is ServiceBinderSpec}
 */
function isValidServiceBinderSpec (val: any): val is ServiceBinderSpec<any> {
  return isObject(val) && isWorkerGlobalScope(val.worker) &&
  isObject(val.service) && (!val.onterminate || isFunction(val.onterminate))
  && isValidMethodsOption(val.methods)
}
/**
 * @private
 * @function isValidMethodsOption
 * @param {*} val
 * @return {val is string[]}
 */
function isValidMethodsOption (val: any): val is string[] {
  return !val || Array.isArray(val) && val.every(prop => isString(prop))
}
/**
 * @param {any} val
 * @return {val is DedicatedWorkerGlobalScope}
 */
function isWorkerGlobalScope (val: any): val is DedicatedWorkerGlobalScope {
  return isObject(val) && isFunction(val.postMessage)
}
/**
 * @param {any} val
 * @return {val is WorkerServiceMethodCall}
 */
function isValidWorkerServiceMethodCall (val: any):
val is IndexedMethodCallSpec {
  return isObject(val) && (!val.target || isString(val.target)) &&
  isString(val.method) && (!val.args || isArrayLike(val.args))
}
/**
 * @private
 * @function isObjectPrototype
 * @param {any} val
 * @return {boolean} true if val is the root Object prototype
 */
function isObjectPrototype (val: any): boolean {
  return isObject(val) && !isObject(Object.getPrototypeOf(val))
}

const hookService: ServiceBinder = WorkerServiceClass.hookService
export default hookService