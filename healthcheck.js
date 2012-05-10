var util = require('util'),
    pg = require('pg').native,
    EventEmitter = require('events').EventEmitter;

function HealthCheck(backend, health) {
  this.timeout = health && health.timeout || 2000;
  this.interval = health && health.interval || 3000;
  this.num_retries = health && health.num_retries || 5;
  this.uri = 'tcp://' + backend.user + ':' + backend.port + '@' + backend.host + '/' + backend.user;

  if (this.timeout < 2000) {
    // set minimal possible value equal to minimal recommended PGCONNECT_TIMEOUT (libpq)
    this.timeout = 2000;
  };

  if (this.interval < this.timeout+1000) {
    // set a little bit bigger health check interval
    util.log('[INFO]  Health check interval is smaller then connection timeout!');
    util.log('[INFO]  Setting interval to minimum allowed value');
    this.interval = this.timeout+1000;
  };
}

util.inherits(HealthCheck, EventEmitter);


// Health check probe (single) 
HealthCheck.prototype.probe = function(callback) {
    var client = new pg.Client(this.uri);
    var query = client.query('SELECT pg_is_in_recovery() AS is_standby');
    var that = this;

    client.connect();

    this.timerHandle = setTimeout(function() {
      // timeout occured - cancel all listeners
      client.removeAllListeners();
      that.status = false;
      client.end();
      callback(new Error('Connection probe to ' + that.uri + ' failed - timeout'));
    }, this.timeout+500);

    client.on('error', function(err) {
      clearTimeout(that.timerHandle);
      that.status = false;
      client.end();
      callback(new Error('Connection probe to ' + that.uri + ' failed'));
    });

    query.once('row', function(row) {
      clearTimeout(that.timerHandle);
      
      if (!that.status) {
	that.status = true;
        util.log('[INFO]  Successful connection attempt to ' + that.uri);
      };

      if (row.is_standby) {
        if (!that.standby) {
	  that.master = false;
	  that.emit('standby');
	  that.standby = true;

          util.log('[INFO]  State change: ' + that.uri + ' is standby');
	}
      }
      else {
        if (!that.master) {
          that.master = true;
          that.emit('master');
          that.standby = false;
          util.log('[INFO]  State change: ' + that.uri + ' is master');
        }
      };
    });

    query.on('end', function() {
      client.end();
      callback(null);
    });
}

// recursively calls probe and counts failures
HealthCheck.prototype.start = function() {
  var that = this;
  var count = 0;
  (function schedule_probe() {
    that.timerIntervalHandle = setTimeout(function() {
      that.probe(function(err) {
        if (err) {
          util.log('[ERROR] ' + err.message);
	  if (count++ >= that.num_retries) {
	    that.standby = false;
	    that.master = false;
	    that.emit('failure');
	    util.log('[ERROR] Backend ' + that.uri + ' failure');
	    count = 0;
	    schedule_probe();
	  }
	  else {
	    schedule_probe();
	  }
        }
        else {
	  count = 0;
          //util.log('[INFO]  Health check to ' + that.uri + ' successful');
	  schedule_probe();
        };
      });
    }, that.interval);
  })();
}

// stops heathchecks
HealthCheck.prototype.stop = function() {
  clearTimeout(this.timerIntervalHandle);
}

exports.HealthCheck = HealthCheck;
