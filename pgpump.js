var net = require('net'),
    config = require('./config.js').readconfig('./pgpump.conf'),
    lookup = require('dns').lookup,
    networkInterfaces = require('os').networkInterfaces,
    util = require('util'),
    numCPUs = require('os').cpus().length,
    cluster = require('cluster'),
    health = require('./healthcheck.js'),
    WorkerPump = require('./worker.js').WorkerPump;

function PgPump(config) {
  this.backends = [];
  this.workers = [];
  
  var that = this;
  // Append to backends array
  Object.keys(config).filter(function(value) {
    if (config.hasOwnProperty(value)) {
      // Exclude 'general' and 'health' entries in config file
      return (value !== 'health') && (value !== 'general');
    } 
    else {
      return false;
    } 
  }).forEach(function(name) {
    var backend = config[name];
    backend.healthcheck = new health.HealthCheck(backend, config.health);
    that.backends.push(backend);
  });
}

PgPump.prototype.respawn = function() {
  var that = this;
  if (this.workers.length === 0) {
    // Fork processes
    for (var i = 0; i < numCPUs; i++) {
      this.workers.push(cluster.fork());
    }
  };
  this.workers.forEach(function(worker) {
    worker.send({master: {
      host: that.master.host,
      port: that.master.port
    }});
  });
}
  
if (cluster.isMaster) {
  var pumpmaster = new PgPump(config);

  util.log('[INFO]  Starting up ' + __filename.split('/').pop() + ', master PID=' + process.pid);
  pumpmaster.backends.forEach(function(backend) {
    // Start checks
    backend.healthcheck.start();

    // Setup the listeners
    // master signal listener
    backend.healthcheck.on('master', function() {
      pumpmaster.master = backend;
      util.log('[INFO]  Elected ' + backend.healthcheck.uri + ' as master');
      pumpmaster.respawn();
    });

    // standby signal listener
    backend.healthcheck.on('slave', function() {
      backend.standby = true;

      if (pumpmaster.master && (backend.healthcheck.uri === pumpmaster.master.healthcheck.uri)) {
	pumpmaster.master = undefined;
        util.log('[INFO]  State change, former master ' + backend.healthcheck.uri + ' added to standby pool');
      }
      else {
        util.log('[INFO]  Backend ' + backend.healthcheck.uri + ' added to standby pool');
      };
    });

    // failure signal listener
    backend.healthcheck.on('failover', function() {
      if (backend.healthcheck.uri === pumpmaster.master.healthcheck.uri) {
        // Failover
	var keys = Object.keys(pumpmaster.backends);
	for (var i = 0, length = keys.length; i < length; i++) {
	  if (pumpmaster.backends[i].standby) {
	    // Promote DB here
	    lookup(pumpmaster.backends[i].host, function(err, address) {
	      if (err) {
	        util.log('[ERROR] Cannot resolve host ' + pumpmaster.backends[i].host);
	      }
	      else {
	        var ifaces = networkInterfaces(),
		    ikeys = Object.keys(ifaces),
		    match = false;
		for (var j = 0; j < ikeys.length; j++) {
		  if (pumpmaster.backends[j].host === address) {
		    var now = new Date();
		    writeFileSync('failover', now);
		    break;
		  }
		}
              }
	    });
            break;
	  }
	}
      }
      else if (backend.standby) {
        backend.standby = false;
	util.log('[INFO]  Backend ' + backend.healthcheck.uri + ' is unavailable and removed from standby pool');
      };
    });
  });

  cluster.on('death', function(worker) {
    var worker_index = pumpmaster.workers.indexOf(worker);
    util.log('[WARNING] worker-' + worker.pid + ' died');
    delete pumpmaster.workers[worker_index];
    pumpmaster.workers[worker_index] = cluster.fork();
    util.log('[INFO]  Spawned worker-' + pumpmaster.workers[worker_index].pid);
    pumpmaster.workers[worker_index].send({master: {
      host: pumpmaster.master.host,
      port: pumpmaster.master.port
    }});
  });

  process.on('SIGTERM', function() {
    cluster.removeAllListeners();
    util.log('[INFO]  Master process PID: ' + process.pid + ' shutting down ' + __filename.split('/').pop());
    process.exit(0);
  });

}
else {
  
  var worker = new WorkerPump(config.general);
  process.on('message', function(msg) {
    if (msg.master) {
      util.log('[INFO]  worker-' + process.pid + ' reconfiguring with new master: ' + 
                msg.master.host + ':' + msg.master.port);
      worker.stop();
      worker.start(msg.master);
    }
  });
  process.on('uncaughtException', function (err) {
    util.log('[worker-' + process.pid + '] Caught Uncaught exception: ' + util.inspect(err,true,null,true));
  });
	  
};

