var path = require('path'),
	fs = require('fs'),
	nconf = require('nconf'),
	express = require('express'),
	express_namespace = require('express-namespace'),
	WebServer = express(),
	server,
	winston = require('winston'),
	async = require('async'),

	emailer = require('./emailer'),
	db = require('./database'),
	auth = require('./routes/authentication'),
	meta = require('./meta'),
	user = require('./user'),
	notifications = require('./notifications'),
	logger = require('./logger'),
	plugins = require('./plugins'),
	middleware = require('./middleware'),
	routes = require('./routes'),
	emitter = require('./emitter'),

	helpers = require('./../public/src/helpers')();

if(nconf.get('ssl')) {
	server = require('https').createServer({
		key: fs.readFileSync(nconf.get('ssl').key),
		cert: fs.readFileSync(nconf.get('ssl').cert)
	}, WebServer);
} else {
	server = require('http').createServer(WebServer);
}

(function (app) {
	"use strict";

	var	port = nconf.get('PORT') || nconf.get('port');

	logger.init(app);
	auth.registerApp(app);
	emailer.registerApp(app);
	notifications.init();
	user.startJobs();

	// Preparation dependent on plugins
	plugins.ready(function() {
		meta.js.minify(app.enabled('minification'));
		meta.css.minify();
		meta.sounds.init();
	});

	async.parallel({
		themesData: meta.themes.get,
		currentThemeId: function(next) {
			db.getObjectField('config', 'theme:id', next);
		}
	}, function(err, data) {
		middleware = middleware(app, data);
		routes(app, middleware);

		if (err) {
			winston.error('Errors were encountered while attempting to initialise NodeBB.');
			process.exit();
		} else {
			if (process.env.NODE_ENV === 'development') {
				winston.info('Middlewares loaded.');
			}
		}
	});

	// Cache static files on production
	if (global.env !== 'development') {
		app.enable('cache');
		app.enable('minification');

		// Configure cache-buster timestamp
		require('child_process').exec('git describe --tags', {
			cwd: path.join(__dirname, '../')
		}, function(err, stdOut) {
			if (!err) {
				meta.config['cache-buster'] = stdOut.trim();
			} else {
				fs.stat(path.join(__dirname, '../package.json'), function(err, stats) {
					meta.config['cache-buster'] = new Date(stats.mtime).getTime();
				});
			}
		});
	}

	if (port !== 80 && port !== 443 && nconf.get('use_port') === false) {
		winston.info('Enabling \'trust proxy\'');
		app.enable('trust proxy');
	}

	if ((port === 80 || port === 443) && process.env.NODE_ENV !== 'development') {
		winston.info('Using ports 80 and 443 is not recommend; use a proxy instead. See README.md');
	}

	module.exports.server = server;
	module.exports.init = function () {
		server.on("error", function(err){
			if (err.code === 'EADDRINUSE') {
				winston.error('NodeBB address in use, exiting...');
				process.exit(1);
			} else {
				throw err;
			}
		});

		emitter.on('templates:compiled', function() {
			var	bind_address = ((nconf.get('bind_address') === "0.0.0.0" || !nconf.get('bind_address')) ? '0.0.0.0' : nconf.get('bind_address')) + ':' + port;
			winston.info('NodeBB attempting to listen on: ' + bind_address);

			server.listen(port, nconf.get('bind_address'), function(){
				winston.info('NodeBB Ready');
				if (process.send) {
					process.send({
						action: 'ready',
						bind_address: bind_address
					});
				}
			});
		});
	};

}(WebServer));
