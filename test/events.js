'use strict'

var test = require('tape').test
var helper = require('./helper')
var aedes = require('../')
var setup = helper.setup
var connect = helper.connect
var subscribe = helper.subscribe

test('publishes an hearbeat', function (t) {
  t.plan(3)

  var broker = aedes({
    heartbeatInterval: 10 // ms
  })

  broker.subscribe('$SYS/+/heartbeat', function (message, cb) {
    var id = message.topic.match(/\$SYS\/([^/]+)\/heartbeat/)[1]
    t.equal(id, broker.id, 'broker id matches')
    t.deepEqual(message.payload.toString(), id, 'message has id as the payload')
    broker.close(t.pass.bind(t, 'broker closes'))
  })
})

;['$mcollina', '$SYS'].forEach(function (topic) {
  test('does not forward $ prefixed topics to # subscription - ' + topic, function (t) {
    t.plan(4)

    var s = connect(setup())

    subscribe(t, s, '#', 0, function () {
      s.outStream.once('data', function (packet) {
        t.fail('no packet should be received')
      })

      s.broker.mq.emit({
        cmd: 'publish',
        topic: topic + '/hello',
        payload: 'world'
      }, function () {
        t.pass('nothing happened')
      })
    })
  })

  test('does not forward $ prefixed topics to +/# subscription - ' + topic, function (t) {
    t.plan(4)

    var s = connect(setup())

    subscribe(t, s, '+/#', 0, function () {
      s.outStream.once('data', function (packet) {
        t.fail('no packet should be received')
      })

      s.broker.mq.emit({
        cmd: 'publish',
        topic: topic + '/hello',
        payload: 'world'
      }, function () {
        t.pass('nothing happened')
      })
    })
  })
})

test('does not store $SYS topics to QoS 1 # subscription', function (t) {
  t.plan(3)

  var broker = aedes()
  var opts = { clean: false, clientId: 'abcde' }
  var s = connect(setup(broker), opts)

  subscribe(t, s, '#', 1, function () {
    s.inStream.end()

    s.broker.publish({
      cmd: 'publish',
      topic: '$SYS/hello',
      payload: 'world',
      qos: 1
    }, function () {
      s = connect(setup(broker), { clean: false, clientId: 'abcde' }, function () {
        t.end()
      })

      s.outStream.once('data', function (packet) {
        t.fail('no packet should be received')
      })
    })
  })
})

test('Emit event when receives a ping', function (t) {
  t.plan(6)
  t.timeoutAfter(2000)

  var broker = aedes()

  broker.on('ping', function (packet, client) {
    if (client && client) {
      t.equal(client.id, 'abcde')
      t.equal(packet.cmd, 'pingreq')
      t.equal(packet.payload, null)
      t.equal(packet.topic, null)
      t.equal(packet.length, 0)
      t.pass('ended')
      broker.close()
    }
  })

  var s = connect(setup(broker), { clientId: 'abcde' })

  s.inStream.write({
    cmd: 'pingreq'
  })
})

test('Emit event when broker closed', function (t) {
  t.plan(1)

  var broker = aedes()
  broker.once('closed', function () {
    t.ok(true)
  })
  broker.close()
})

// raw bad packet tests
;[
  [
    'Invalid protocolId',
    Buffer.from([
      0x10, 0x18, // Fixed
      0x00, 0x04, // Protocol name length
      0x4d, 0x51, 0x54, 0x53, // BAD protocol name: MQTS
      0x04, // Protocol version
      0x02, // Connect flags (clean session)
      0x00, 0x3c, // Keep alive
      0x00, 0x0c, // client ID length
      0x62, 0x61, 0x64, 0x70, 0x79, 0x2d, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74 // client ID
    ])
  ],
  [
    'Invalid protocol version',
    Buffer.from([
      0x10, 0x18, // Fixed
      0x00, 0x04, // Protocol name length
      0x4d, 0x51, 0x54, 0x54, // Protocol name: MQTT
      0x02, // BAD Protocol version
      0x02, // Connect flags (clean session)
      0x00, 0x3c, // Keep alive
      0x00, 0x0c, // client ID length
      0x62, 0x61, 0x64, 0x70, 0x79, 0x2d, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74 // client ID
    ])
  ]
].forEach(function (run) {
  var message = run[0]
  var packet = run[1]
  test('Emit error after parsing failure ' + message, function (t) {
    t.plan(2)

    var net = require('net')
    var instance = aedes()
    var server = net.createServer(instance.handle)

    server.listen(4883, function () {
      console.log('listening on 4883')
    })

    instance.once('error', function () {
      console.log('instance error')
    })

    instance.on('connectionError', function (client, err) {
      t.equal(err.message, message)
      t.equal(instance.connectedClients, 0)
      finish()
    })

    var client

    var timer = setTimeout(finish, 10000)

    client = net.createConnection({ port: 4883 }, function () {
      client.write(packet)
    })
    client.on('data', (data) => { })
    client.on('end', () => { })

    function finish () {
      clearTimeout(timer)
      instance.close()
      server.close()
      client.end()
      t.end()
    }
  })
})
