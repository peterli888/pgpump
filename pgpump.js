var net = require('net'),
    fs = require('fs'),
    config = require('./config.js').readconfig('./pgpump.conf'),
    path = require('path'),
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
  var pumpmaster = new PgPump(config),
      basename = path.basename(__filename,'.js'),
      pidfile = '/var/run/' + basename + '/' + basename + '.pid';


  if (path.existsSync(pidfile)) {
    util.log('[ERROR] PID file ' + pidfile + ' already exists!');
    util.log('[ERROR] Another ' + basename + ' instance is running or stale PID file');
    process.exit(1);
  };
  //process.setuid(26);
  // Write PID file
  fs.writeFileSync(pidfile, process.pid);
  // Start
  util.log('[INFO]  Starting up ' + pidfile + ', master PID=' + process.pid);
  pumpmaster.backends.forEach(function(backend) {
    // Start checks
    backend.healthcheck.start();

    // Setup the listeners
    // master signal listener
    backend.healthcheck.on('master', function() {
      if (pumpmaster.master && (backend.healthcheck.uri !== pumpmaster.master.healthcheck.uri)) {
        pumpmaster.master.healthcheck.probe(function(err) { 
	  if (err) {
            pumpmaster.master = backend;
	    pumpmaster.respawn();
	    util.log('[INFO]  Switched to new master ' + backend.healthcheck.uri);
	  }
	  else {
            // Reset per-backend role flag
            backend.healthcheck.master = false;
	    util.log('[ERROR] Multiple master databases detected');
	    util.log('[ERROR] Master database is ' + pumpmaster.master.healthcheck.url);
	    util.log('[ERROR] New master request from ' + backend.healthcheck.url + ' abandoned');
	    util.log('[ERROR] Please resolve the split brain situation by recovering one of the backends as standby');
	  }
        });
      }
      else {
        pumpmaster.master = backend;
        util.log('[INFO]  Elected ' + backend.healthcheck.uri + ' as master');
        pumpmaster.respawn();
      }
    });

    // standby signal listener
    backend.healthcheck.on('standby', function() {
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
    backend.healthcheck.on('failure', function() {
      util.log('[WARNING] Caught failure signal');
      if (backend.healthcheck.uri == pumpmaster.master.healthcheck.uri) {
        // Failover
	var keys = Object.keys(pumpmaster.backends);
        // TODO: split up this loop in two
	for (var i = 0, length = keys.length; i < length; i++) {
	  if (pumpmaster.backends[i].standby) {
	    // Promote DB here
	    lookup(pumpmaster.backends[i].host, function(err, address) {
	      if (err) {
	        util.log('[ERROR] Cannot resolve host ' + pumpmaster.backends[i].host);
	      }
	      else {
	        var ifaces = networkInterfaces(),
		    ikeys = Object.keys(ifaces);
		for (var j = 0; j < ikeys.length; j++) {
                  console.log(address);
		  if (ifaces[ikeys[j]].address === address) {
		    var now = new Date();
		    writeFileSync('failover', now);
                    util.log('[INFO]  Promoted ' + pumpmaster.backends[i].uri + ' to master!');
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

  process.once('SIGTERM', function() {
    cluster.removeAllListeners();
    util.log('[INFO]  Master process PID: ' + process.pid + ' shutting down ' + basename);
    pumpmaster.workers.forEach(function(worker) {
      process.kill(worker.pid);
    });

    fs.unlinkSync(pidfile);

    process.exit(0);
  });

  process.on('uncaughtException', function(err) {
    util.log('[WARNING] Caught exception: ' + err);
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
  process.on('uncaughtException', function(err) {
    util.log('[worker-' + process.pid + '] Caught Uncaught exception: ' + util.inspect(err,true,null,true));
  });
};

