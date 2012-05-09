var ini = require('ini'),
    fs = require('fs');

var readconfig = function(config_file) {
  var config = ini.parse(fs.readFileSync(config_file, 'utf-8'));
  return config;
}

exports.readconfig = readconfig;
