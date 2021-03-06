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
import hookService from '../../src/worker'
import Promise = require('bluebird')

let worker: DedicatedWorkerGlobalScope
let service: {
  syncwork: (foo: string, bar: string) => number
  asyncwork: (foo: string, bar: string) => Promise<number>
  stop: () => void
}
let onterminate: () => (void | Promise<void>)

beforeEach(() => {
  worker = jasmine.createSpyObj('worker', [ 'postMessage' ])
  // place the service methods on the prototype of the service instance
  service = Object.create(jasmine.createSpyObj('service',
  [ 'asyncwork', 'syncwork', 'stop' ]))
  ;(<jasmine.Spy>service.syncwork).and.returnValue('foo')
  ;(<jasmine.Spy>service.asyncwork).and.returnValue(Promise.resolve('foo'))
  onterminate = service.stop.bind(service)
})

beforeEach(() => {
  hookService({
    worker: worker,
    service: service,
    onterminate: onterminate
  })
})

describe('function hookService <S extends Object>({ worker: DedicatedWorkerGlobalScope, ' +
'service: S, onterminate?: () => Promise<void>, methods?: string[] }): void', () => {
  it('should add an "onmessage" handler to the given worker', () => {
    expect(worker.onmessage).toEqual(jasmine.any(Function))
  })

  describe('when the supplied argument is not an object', () => {
    it('should throw an "invalid argument" TypeError', () => {
      expect(() => hookService(<any>42))
      .toThrowError(TypeError, 'invalid argument')
    })
  })

  describe('when "worker" is not defined or not a DedicatedWorkerGlobalScope object',
  () => {
    it('should throw an "invalid argument" TypeError', () => {
      expect(() => hookService(<any>{
        service: service,
        onterminate: onterminate
      }))
      .toThrowError(TypeError, 'invalid argument')
      expect(() => hookService(<any>{
        worker: {}, // missing postMessage method
        service: service,
        onterminate: onterminate
      }))
      .toThrowError(TypeError, 'invalid argument')
    })
  })

  describe('when "service" is not defined or not an object', () => {
    it('should throw an "invalid argument" TypeError', () => {
      expect(() => hookService(<any>{
        worker: worker,
        onterminate: onterminate
      }))
      .toThrowError(TypeError, 'invalid argument')
      expect(() => hookService(<any>{
        worker: worker,
        service: 42,
        onterminate: onterminate
      }))
      .toThrowError(TypeError, 'invalid argument')
    })
  })

  describe('when "onterminate" is defined but not a method', () => {
    it('should throw an "invalid argument" TypeError', () => {
      expect(() => hookService(<any>{
        worker: worker,
        service: service
      }))
      .not.toThrow()
      expect(() => hookService(<any>{
        worker: worker,
        service: service,
        onterminate: 42
      }))
      .toThrowError(TypeError, 'invalid argument')
    })
  })

  describe('when "methods" is defined but not a an array of strings', () => {
    it('should throw an "invalid argument" TypeError', () => {
      expect(() => hookService(<any>{
        worker: worker,
        service: service
      }))
      .not.toThrow()
      expect(() => hookService(<any>{
        worker: worker,
        service: service,
        methods: [ "foo", 42 ]
      }))
      .toThrowError(TypeError, 'invalid argument')
    })
  })

  describe('when "methods" is an array of strings', () => {
    beforeEach(() => {
      const data = [ {
        uuid: 42,
        target: 'service',
        method: 'syncwork',
        args: [ 'foo', 'bar' ]
      }, {
        uuid: 42,
        target: 'service',
        method: 'asyncwork',
        args: [ 'foo', 'bar' ]
      } ]
      hookService(<any>{
        worker: worker,
        service: service,
        methods: [ "syncwork" ]
      })
      data.forEach((data: any) => worker.onmessage(<MessageEvent>{ data: data }))
    })

    it('should expose only the service methods listed in the "methods" array', () => {
      expect(service.syncwork).toHaveBeenCalledTimes(1)
      expect(service.asyncwork).not.toHaveBeenCalled()
      expect(service.stop).not.toHaveBeenCalled()
    })
  })

  describe('handler onmessage (event: WorkerServiceEvent): void', () => {
    let data: any
    let postMethodCall: (data: any, done?: DoneFn) => void
    beforeEach(() => {
      data = {
        uuid: 42,
        target: 'service',
        method: 'syncwork',
        args: [ 'foo', 'bar' ]
      }
      postMethodCall = (data: any, done?: DoneFn) => {
        if (done) {
          ;(<jasmine.Spy>worker.postMessage)
          .and.callFake(() => setTimeout(done)) // properly resolve pending promise
        }
        worker.onmessage(<MessageEvent>{ data: data })
      }
    })

    it('should call the target method as specified in "event.data"', () => {
      postMethodCall(data)

      const expectSyncwork = expect(service.syncwork)
      expectSyncwork.toHaveBeenCalledWith.apply(expectSyncwork, data.args)
      expect(service.syncwork).toHaveBeenCalledTimes(1)
      expect(service.asyncwork).not.toHaveBeenCalled()
      expect(service.stop).not.toHaveBeenCalled()
    })

    describe('when "event.data.args" is falsy', () => {
      beforeEach((done) => {
        delete data.args
        postMethodCall(data, done)
      })
      it('should call the target method as specified in "event.data" ' +
      'with no arguments', () => {
        expect(service.syncwork).toHaveBeenCalledTimes(1)
        expect(service.syncwork).toHaveBeenCalledWith()
      })
    })

    describe('when "event.data.args" is truthy but not Array-like', () => {
      beforeEach((done) => {
        data.args = { foo: 42 }
        postMethodCall(data, done)
      })
      it('should post a request back to reject ' +
      'with an "invalid argument" TypeError', () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'TypeError',
            message: 'invalid argument',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when "event.data.uuid" is not a safe integer', () => {
      beforeEach((done) => {
        data.uuid = Number.MAX_VALUE
        postMethodCall(data, done)
      })
      it('should post a request back to reject ' +
      'with an "invalid argument" TypeError', () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: Number.MAX_VALUE,
          method: 'reject',
          args: [ {
            name: 'TypeError',
            message: 'invalid argument',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when "event.data.target" is not a string', () => {
      beforeEach((done) => {
        data.target = 64
        postMethodCall(data, done)
      })
      it('should post a request back to reject ' +
      'with an "invalid argument" TypeError', () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'TypeError',
            message: 'invalid argument',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when "event.data.method" is not a string', () => {
      beforeEach((done) => {
        data.method = 64
        postMethodCall(data, done)
      })
      it('should post a request back to reject ' +
      'with an "invalid argument" TypeError', () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'TypeError',
            message: 'invalid argument',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when "event.data.target" is unknown', () => {
      beforeEach((done) => {
        data.target = 'shazam'
        postMethodCall(data, done)
      })
      it('should post a request back to reject with an "unknown method" Error',
      () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'Error',
            message: 'unknown method',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when the specified target method is unknown', () => {
      beforeEach((done) => {
        data.method = 'shazam'
        postMethodCall(data, done)
      })
      it('should post a request back to reject with an "unknown method" Error',
      () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'Error',
            message: 'unknown method',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when the target method successfully returns', () => {
      beforeEach((done) => {
        postMethodCall(data, done)
      })
      it('should post a request back to resolve to the returned value', () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'resolve',
          args: [ 'foo' ]
        })
      })
    })

    describe('when the target method successfully resolves', () => {
      beforeEach((done) => {
        data.method = 'asyncwork'
        postMethodCall(data, done)
      })
      it('should post a request back to resolve to the resolved value', () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'resolve',
          args: [ 'foo' ]
        })
      })
    })

    describe('when the target method throws', () => {
      beforeEach((done) => {
        data.method = 'syncwork'
        ;(<jasmine.Spy>service.syncwork)
        .and.callFake(() => { throw new Error('boom') })
        postMethodCall(data, done)
      })
      it('should post a request back to reject with the corresponding error',
      () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'Error',
            message: 'boom',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when the target method rejects', () => {
      beforeEach((done) => {
        data.method = 'asyncwork'
        ;(<jasmine.Spy>service.asyncwork)
        .and.returnValue(Promise.reject(new Error('boom')))
        postMethodCall(data, done)
      })
      it('should post a request back to reject with the corresponding error',
      () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'reject',
          args: [ {
            name: 'Error',
            message: 'boom',
            stack: jasmine.anything()
          } ]
        })
      })
    })

    describe('when the target method specification is ' +
    '{ method: "getServiceMethods" }', () => {
      beforeEach((done) => {
        delete data.target
        data.method = 'getServiceMethods'
        postMethodCall(data, done)
      })
      it('should post a request back to resolve to the list of service methods',
      () => {
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({
          uuid: 42,
          method: 'resolve',
          args: [ [ 'asyncwork', 'syncwork', 'stop' ] ] // uuid, result
        })
      })
    })
  })
})