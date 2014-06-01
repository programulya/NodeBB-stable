'use strict';


/* globals define, app, templates, translator, socket, bootbox, config, ajaxify, RELATIVE_PATH, utils */

define(['forum/pagination', 'forum/infinitescroll', 'forum/topic/threadTools', 'forum/topic/postTools', 'forum/topic/events', 'navigator'], function(pagination, infinitescroll, threadTools, postTools, events, navigator) {
	var	Topic = {},
		scrollingToPost = false,
		currentUrl = '';


	$(window).on('action:ajaxify.start', function(ev, data) {
		if(data.url.indexOf('topic') !== 0) {
			navigator.hide();
			$('.header-topic-title').find('span').text('').hide();
			app.removeAlert('bookmark');

			events.removeListeners();

			socket.removeListener('event:new_post', onNewPost);
		}
	});

	Topic.init = function() {
		var tid = ajaxify.variables.get('topic_id'),
			thread_state = {
				locked: ajaxify.variables.get('locked'),
				deleted: ajaxify.variables.get('deleted'),
				pinned: ajaxify.variables.get('pinned')
			},
			postCount = ajaxify.variables.get('postcount');

		$(window).trigger('action:topic.loading');

		app.enterRoom('topic_' + tid);

		showBottomPostBar();

		postTools.init(tid, thread_state);
		threadTools.init(tid, thread_state);
		events.init();

		hidePostToolsForDeletedPosts();

		enableInfiniteLoadingOrPagination();

		addBlockquoteEllipses($('.topic .post-content > blockquote'));

		var bookmark = localStorage.getItem('topic:' + tid + ':bookmark');
		if (window.location.hash) {
			Topic.scrollToPost(window.location.hash.substr(1), true);
		} else if (bookmark && (!config.usePagination || (config.usePagination && pagination.currentPage === 1)) && postCount > 1) {
			app.alert({
				alert_id: 'bookmark',
				message: '[[topic:bookmark_instructions]]',
				timeout: 0,
				type: 'info',
				clickfn : function() {
					Topic.scrollToPost(parseInt(bookmark, 10), true);
				},
				closefn : function() {
					localStorage.removeItem('topic:' + tid + ':bookmark');
				}
			});
		}

		if (!config.usePagination) {
			navigator.init('.posts > .post-row', postCount, Topic.navigatorCallback);
		}

		socket.on('event:new_post', onNewPost);

		$(window).on('scroll', updateTopicTitle);

		$(window).trigger('action:topic.loaded');
	};

	function showBottomPostBar() {
		if($('#post-container .post-row').length > 1 || !$('#post-container li[data-index="0"]').length) {
			$('.bottom-post-bar').removeClass('hide');
		}
	}

	function onNewPost(data) {
		var tid = ajaxify.variables.get('topic_id');
		if(data && data.posts && data.posts.length && data.posts[0].tid !== tid) {
			return;
		}

		if(config.usePagination) {
			return onNewPostPagination(data);
		}

		for (var i=0; i<data.posts.length; ++i) {
			var postcount = $('.user_postcount_' + data.posts[i].uid);
			postcount.html(parseInt(postcount.html(), 10) + 1);
		}

		socket.emit('topics.markAsRead', {tid: tid, uid: app.uid});
		createNewPosts(data);
	}

	function addBlockquoteEllipses(blockquotes) {
		blockquotes.each(function() {
			var $this = $(this);
			if ($this.find(':hidden').length && !$this.find('.toggle').length) {
				$this.append('<i class="fa fa-ellipsis-h pointer toggle"></i>');
			}
		});

		$('blockquote .toggle').on('click', function() {
			$(this).parent('blockquote').toggleClass('uncollapsed');
		});
	}

	function enableInfiniteLoadingOrPagination() {
		if(!config.usePagination) {
			infinitescroll.init(loadMorePosts);
		} else {
			navigator.hide();

			pagination.init(parseInt(ajaxify.variables.get('currentPage'), 10), parseInt(ajaxify.variables.get('pageCount'), 10));
		}
	}

	function hidePostToolsForDeletedPosts() {
		$('#post-container li.deleted').each(function() {
			postTools.toggle($(this).attr('data-pid'), true);
		});
	}


	function updateTopicTitle() {
		if($(window).scrollTop() > 50) {
			$('.header-topic-title').find('span').text(ajaxify.variables.get('topic_name')).show();
		} else {
			$('.header-topic-title').find('span').text('').hide();
		}
	}

	Topic.navigatorCallback = function(element) {
		var pid = element.attr('data-pid');

		var currentBookmark = localStorage.getItem('topic:' + ajaxify.variables.get('topic_id') + ':bookmark');

		if (!currentBookmark || parseInt(pid, 10) >= parseInt(currentBookmark, 10)) {
			localStorage.setItem('topic:' + ajaxify.variables.get('topic_id') + ':bookmark', pid);
			app.removeAlert('bookmark');
		}

		if (!scrollingToPost) {

			var newUrl = window.location.href.replace(window.location.hash, '') + '#' + pid;

			if (newUrl !== currentUrl) {
				if (history.replaceState) {
					history.replaceState({
						url: window.location.pathname.slice(1) + (window.location.search ? window.location.search : '' ) + '#' + pid
					}, null, newUrl);
				}
				currentUrl = newUrl;
			}
		}
	};

	Topic.scrollToPost = function(pid, highlight, duration, offset) {
		if (!pid) {
			return;
		}

		if(!offset) {
			offset = 0;
		}

		scrollingToPost = true;

		if($('#post_anchor_' + pid).length) {
			return scrollToPid(pid);
		}

		if(config.usePagination) {
			socket.emit('posts.getPidPage', pid, function(err, page) {
				if(err) {
					return;
				}
				if(parseInt(page, 10) !== pagination.currentPage) {
					pagination.loadPage(page, function() {
						scrollToPid(pid);
					});
				} else {
					scrollToPid(pid);
				}
			});
		} else {
			socket.emit('posts.getPidIndex', pid, function(err, index) {
				if(err) {
					return;
				}

				$('#post-container').empty();
				var after = index - config.postsPerPage + 1;
				if(after < 0) {
					after = 0;
				}

				loadPostsAfter(after, function() {
					scrollToPid(pid);
				});
			});
		}

		function scrollToPid(pid) {
			var scrollTo = $('#post_anchor_' + pid),
				tid = $('#post-container').attr('data-tid');

			function animateScroll() {
				$('html, body').animate({
					scrollTop: (scrollTo.offset().top - $('#header-menu').height() - offset) + 'px'
				}, duration !== undefined ? duration : 400, function() {
					scrollingToPost = false;
					navigator.update();
					highlightPost();
				});
			}

			function highlightPost() {
				if (highlight) {
					scrollTo.parent().find('.topic-item').addClass('highlight');
					setTimeout(function() {
						scrollTo.parent().find('.topic-item').removeClass('highlight');
					}, 5000);
				}
			}


			if (tid && scrollTo.length) {
				if($('#post-container li.post-row[data-pid="' + pid + '"]').attr('data-index') !== '0') {
					animateScroll();
				} else {
					navigator.update();
					highlightPost();
				}
			}
		}
	};

	function onNewPostPagination(data) {
		var posts = data.posts;
		socket.emit('topics.getPageCount', ajaxify.variables.get('topic_id'), function(err, newPageCount) {

			pagination.recreatePaginationLinks(newPageCount);

			if (pagination.currentPage === pagination.pageCount) {
				createNewPosts(data);
			} else if(data.posts && data.posts.length && parseInt(data.posts[0].uid, 10) === parseInt(app.uid, 10)) {
				pagination.loadPage(pagination.pageCount);
			}
		});
	}

	function createNewPosts(data, callback) {
		if(!data || (data.posts && !data.posts.length)) {
			return;
		}

		function removeAlreadyAddedPosts() {
			data.posts = data.posts.filter(function(post) {
				return $('#post-container li[data-pid="' + post.pid +'"]').length === 0;
			});
		}

		var after = null,
			before = null;

		function findInsertionPoint() {
			var firstPid = parseInt(data.posts[0].pid, 10);

			$('#post-container li[data-pid]').each(function() {
				var $this = $(this);

				if(firstPid > parseInt($this.attr('data-pid'), 10)) {
					after = $this;
					if(after.next().length && after.next().hasClass('post-bar')) {
						after = after.next();
					}
				} else {
					return false;
				}
			});

			if (!after) {
				var firstPost = $('#post-container .post-row').first();
				if(firstPid < parseInt(firstPost.attr('data-pid'), 10)) {
					before = firstPost;
				}
			}
		}

		removeAlreadyAddedPosts();
		if(!data.posts.length) {
			return;
		}

		findInsertionPoint();

		data.title = ajaxify.variables.get('topic_name');
		data.viewcount = ajaxify.variables.get('viewcount');

		infinitescroll.parseAndTranslate('topic', 'posts', data, function(html) {
			if(after) {
				html.insertAfter(after);
			} else if(before) {
				html.insertBefore(before);
			} else {
				$('#post-container').append(html);
			}

			html.hide().fadeIn('slow');

			addBlockquoteEllipses(html.find('.post-content > blockquote'));

			onNewPostsLoaded(html, data.posts);
			if (typeof callback === 'function') {
				callback();
			}
		});
	}

	function onNewPostsLoaded(html, posts) {
		function getPostPrivileges(pid) {
			socket.emit('posts.getPrivileges', pid, function(err, privileges) {
				if(err) {
					return app.alertError(err.message);
				}
				toggleModTools(html, privileges);
			});
		}

		for (var x = 0, numPosts = posts.length; x < numPosts; x++) {
			getPostPrivileges(posts[x].pid);
		}

		app.populateOnlineUsers();
		app.createUserTooltips();
		utils.addCommasToNumbers(html.find('.formatted-number'));
		utils.makeNumbersHumanReadable(html.find('.human-readable-number'));
		html.find('span.timeago').timeago();
		html.find('.post-content img').addClass('img-responsive');
		postTools.updatePostCount();
		showBottomPostBar();
	}

	function toggleModTools(postHtml, privileges) {
		postHtml.find('.edit, .delete').toggleClass('none', !privileges.editable);
		postHtml.find('.move').toggleClass('none', !privileges.move);
		postHtml.find('.reply, .quote').toggleClass('none', !$('.post_reply').length);
		var isSelfPost = parseInt(postHtml.attr('data-uid'), 10) === parseInt(app.uid, 10);
		postHtml.find('.chat, .flag').toggleClass('none', isSelfPost);
	}

	function loadMorePosts(direction) {
		if (!$('#post-container').length) {
			return;
		}

		infinitescroll.calculateAfter(direction, '#post-container .post-row', config.postsPerPage, function(after, offset, el) {
			loadPostsAfter(after, function() {
				if (direction < 0 && el) {
					Topic.scrollToPost(el.attr('data-pid'), false, 0, offset);
				}
			});
		});
	}

	function loadPostsAfter(after, callback) {
		if (!utils.isNumber(after) || (after === 0 && $('#post-container li.post-row[data-index="0"]').length)) {
			return;
		}

		var indicatorEl = $('.loading-indicator');
		if (!indicatorEl.is(':animated')) {
			indicatorEl.fadeIn();
		}

		infinitescroll.loadMore('topics.loadMore', {
			tid: ajaxify.variables.get('topic_id'),
			after: after
		}, function (data) {

			indicatorEl.fadeOut();

			if (data && data.posts && data.posts.length) {
				createNewPosts(data, callback);
				hidePostToolsForDeletedPosts();
			} else {
				navigator.update();
			}
		});
	}

	return Topic;
});
