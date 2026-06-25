(function () {
  "use strict";

  function createScrollManager(options) {
    const settings = options || {};
    const container = settings.container;
    const unreadButton = settings.unreadButton || null;
    const threshold = Number(settings.threshold || 120);
    const state = {
      autoFollowEnabled: true,
      isNearBottom: true,
      unreadMessageCount: 0,
      lastVisibleMessageId: "",
      lastMessageCount: 0,
      lastScrollHeight: 0,
      wasAutoFollowingBeforeRender: true,
      userScrolledAway: false,
      lastUserScrollAwayAt: 0
    };

    function distanceFromBottom() {
      if (!container) return 0;
      return Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop);
    }

    function updateNearBottom() {
      state.isNearBottom = distanceFromBottom() <= threshold;
      state.autoFollowEnabled = state.isNearBottom;
      state.userScrolledAway = !state.isNearBottom;
      if (state.userScrolledAway) {
        state.lastUserScrollAwayAt = Date.now();
      }
      renderUnreadButton();
      return state.isNearBottom;
    }

    function onScroll() {
      updateNearBottom();
      if (state.isNearBottom) {
        clearUnread();
      }
    }

    function bind() {
      if (!container) return;
      container.addEventListener("scroll", onScroll, { passive: true });
      if (unreadButton) {
        unreadButton.addEventListener("click", function () {
          scrollToBottom({ force: true, behavior: "auto", userInitiated: true });
        });
      }
      window.requestAnimationFrame(updateNearBottom);
    }

    function beforeRender() {
      const physicallyNearBottom = distanceFromBottom() <= threshold;
      const wasFollowing = physicallyNearBottom || (state.autoFollowEnabled && !state.userScrolledAway);
      if (wasFollowing) {
        state.autoFollowEnabled = true;
        state.isNearBottom = true;
        state.userScrolledAway = false;
      } else {
        state.autoFollowEnabled = false;
        state.isNearBottom = false;
        state.userScrolledAway = true;
      }
      state.wasAutoFollowingBeforeRender = Boolean(wasFollowing);
      state.lastScrollHeight = container ? container.scrollHeight : 0;
    }

    function afterRender(options) {
      const nextOptions = options || {};
      const count = Number(nextOptions.messageCount || 0);
      const grew = count > state.lastMessageCount || (container && container.scrollHeight > state.lastScrollHeight);
      state.lastMessageCount = count;
      if (nextOptions.force || state.wasAutoFollowingBeforeRender || nextOptions.important) {
        scrollToBottom({ force: true, behavior: nextOptions.behavior || "auto" });
        return;
      }
      if (grew) {
        state.unreadMessageCount += 1;
        renderUnreadButton();
      }
    }

    function scrollToBottom(options) {
      if (!container) return;
      const force = Boolean(options && options.force);
      const behavior = options && options.behavior ? options.behavior : "auto";
      if (force && state.userScrolledAway && !(options && (options.userInitiated || options.overrideUserScroll))) {
        renderUnreadButton();
        return;
      }
      const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const scrollOptions = { top: container.scrollHeight, behavior: prefersReduced ? "auto" : behavior };
      if (force) {
        state.autoFollowEnabled = true;
        state.isNearBottom = true;
        state.userScrolledAway = false;
      }
      clearUnread();
      try {
        container.scrollTo(scrollOptions);
      } catch (error) {
        container.scrollTop = container.scrollHeight;
      }
      applyBottomFollow(force, options);
      window.requestAnimationFrame(function () {
        applyBottomFollow(force, options);
      });
      window.setTimeout(function () {
        applyBottomFollow(force, options);
      }, 80);
      window.setTimeout(function () {
        applyBottomFollow(force, options);
      }, 180);
      window.setTimeout(function () {
        applyBottomFollow(force, options);
      }, 320);
    }

    function applyBottomFollow(force, options) {
      if (force && state.userScrolledAway && !(options && (options.userInitiated || options.overrideUserScroll))) {
        renderUnreadButton();
        return;
      }
      forceBottom();
      if (force) {
        state.autoFollowEnabled = true;
        state.isNearBottom = true;
        state.userScrolledAway = false;
        renderUnreadButton();
      } else {
        updateNearBottom();
      }
    }

    function forceBottom() {
      const lastMessage = container.querySelector(".his-agent-history > :last-child");
      if (lastMessage) {
        container.scrollTop = Math.max(0, lastMessage.offsetTop + lastMessage.offsetHeight - container.clientHeight + 16);
      }
      container.scrollTop = Math.max(container.scrollTop, container.scrollHeight - container.clientHeight);
    }

    function markImportant() {
      scrollToBottom({ force: true, behavior: "smooth" });
    }

    function clearUnread() {
      state.unreadMessageCount = 0;
      renderUnreadButton();
    }

    function renderUnreadButton() {
      if (!unreadButton) return;
      if (state.unreadMessageCount > 0 && !state.isNearBottom) {
        unreadButton.hidden = false;
        unreadButton.textContent = "↓ " + state.unreadMessageCount + " 条新消息";
      } else {
        unreadButton.hidden = true;
      }
    }

    function getState() {
      return Object.assign({}, state);
    }

    return {
      bind: bind,
      beforeRender: beforeRender,
      afterRender: afterRender,
      scrollToBottom: scrollToBottom,
      markImportant: markImportant,
      clearUnread: clearUnread,
      getState: getState
    };
  }

  window.AgentScrollManager = {
    create: createScrollManager
  };
})();
