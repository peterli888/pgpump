var net = require('net'),
   util = require('util');

function WorkerPump(general) {
  // Creates listener and pumps data to/from database
  this.listen = general;
}

WorkerPump.prototype.start = function(host) {
  this.backend = host;
  var that = this;

  this.server = net.createServer(function(data) {
    // setup pipes
    var conn = net.createConnection(that.backend.port, that.backend.host, function() {
      conn.pipe(data);
    });

    data.pipe(conn);

    conn.on('error', function(err) {
      util.log('[ERROR] worker-' + process.pid + ': ' + err);
    });
  });

  this.server.listen(this.listen.port,this.listen.host);
  this.server.on('listening', function() {
    that.started = true;
  });
}

WorkerPump.prototype.stop = function() {
  if (this.started) {
    var that = this;
    this.server.close();
    this.server.on('close', function() {
      that.started = false;
    });
  }
}

exports.WorkerPump = WorkerPump;
