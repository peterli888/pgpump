var net = require('net'),
   util = require('util');

// Real 2-way pipe in 10 lines of code! ;)

function WorkerPump(host,general) {
  // Creates listener and pumps data to/from database
  this.listen = general;
  this.backend = host;

  var that = this;

  this.server = net.createServer(function(data) {
    // setup pipes
    var conn = net.createConnection(that.backend.port, that.backend.host, function() {
      conn.pipe(data);
    });

    data.pipe(conn);

    conn.on('error', function(err) {
      util.log(err);
    });
  });

  this.server.listen(this.listen.port,this.listen.host);

}

exports.WorkerPump = WorkerPump;
