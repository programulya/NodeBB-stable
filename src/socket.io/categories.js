'use strict';

var	async = require('async'),
	categories = require('../categories'),
	privileges = require('../privileges'),
	meta = require('./../meta'),
	user = require('./../user'),

	SocketCategories = {};

SocketCategories.getRecentReplies = function(socket, cid, callback) {
	privileges.categories.can('read', cid, socket.uid, function(err, canRead) {
		if (err) {
			return callback(err);
		}

		if (!canRead) {
			return callback(null, []);
		}

		categories.getRecentReplies(cid, socket.uid, 4, callback);
	});
};

SocketCategories.get = function(socket, data, callback) {
	categories.getAllCategories(callback);
};

SocketCategories.loadMore = function(socket, data, callback) {
	if(!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.parallel({
		privileges: function(next) {
			privileges.categories.get(data.cid, socket.uid, next);
		},
		settings: function(next) {
			user.getSettings(socket.uid, next);
		}
	}, function(err, results) {
		if (err) {
			return callback(err);
		}

		var start = parseInt(data.after, 10),
			end = start + results.settings.topicsPerPage - 1;

		categories.getCategoryTopics(data.cid, start, end, socket.uid, function(err, data) {
			if (err) {
				return callback(err);
			}

			data.privileges = results.privileges;
			callback(null, data);
		});
	});
};

SocketCategories.getPageCount = function(socket, cid, callback) {
	categories.getPageCount(cid, socket.uid, callback);
};

SocketCategories.getTopicCount = function(socket, cid, callback) {
	categories.getCategoryField(cid, 'topic_count', callback);
};

module.exports = SocketCategories;
