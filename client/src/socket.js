import {onCleanup} from 'solid-js';

const STATUS_NO_RECONNECT = 4444;
const messageCallbacks = new Set();
const reconnectMaxIntervalSeconds = 1800;
const reconnectBackoffFactor = 1.5;
const healthCheckTimeoutMs = 200000;
let reconnectAttempts = 0;
let reconnectTimeout;
let socket;
let lastMessageTime;
let healthCheckInterval;

export default function useSocket(timerKey, options = {}) {
  const {handler = null} = options;
  if (handler) {
    addSocketListener(handler);
    onCleanup(() => {
      removeSocketListener(handler);
    });
  }
  return {
    connectSocket() {
      return connectSocket(timerKey);
    },
    disconnectSocket,
    sendMessage,
    addSocketListener,
    removeSocketListener
  };
}

function addSocketListener(onMessage) {
  messageCallbacks.add(onMessage);
}

function removeSocketListener(onMessage) {
  messageCallbacks.delete(onMessage);
}

function handleEvent(eventName, data) {
  if (eventName == 'ping') {
    const now = Date.now();
    sendMessage('pong', {then: data, now, diff: now - data});
    return;
  }
  if (eventName == 'pong') {
    return;
  }
  for (const cb of messageCallbacks) {
    try {
      cb(eventName, data);
    }
    catch (err) {
      console.error('Error while handling message.');
      console.error(err);
    }
  }
}

function getUrl() {
  const url = new URL(window.location);
  let baseUrlStr = import.meta.env.VITE_API_BASE_URL_SOCKET;
  if (baseUrlStr.indexOf('//') <= 0) {
    baseUrlStr = `${url.protocol}//${baseUrlStr}`;
  }
  const baseUrl = new URL(baseUrlStr);
  const protocol = baseUrl.protocol === 'wss:' || baseUrl.protocol === 'https:' ? 'wss://' : 'ws://';
  return protocol + baseUrl.host + baseUrl.pathname;
}

function attachSocketListeners() {
  socket.addEventListener('open', () => {
    cancelReconnect();
    clearInterval(healthCheckInterval);
    setInterval(() => {
      const now = Date.now();
      if (now - lastMessageTime > healthCheckTimeoutMs) {
        sendMessage('ping', {now});
      }
    }, healthCheckTimeoutMs);
    handleEvent('open');
  });
  socket.addEventListener('message', event => {
    lastMessageTime = Date.now();
    const parsedEvent = JSON.parse(event.data);
    if (parsedEvent?.constructor !== Array) {
      console.error('WS: Invalid event payload type.');
    }
    const [eventName, data] = parsedEvent;
    handleEvent(eventName, data);
  });
  socket.addEventListener('error', event => {
    handleEvent('error', event);
  });
  socket.addEventListener('close', event => {
    socket = null;
    window.socket = null;
    clearInterval(healthCheckInterval);
    handleEvent('close');
    if (event.code == STATUS_NO_RECONNECT) {
      return;
    }

    console.warn('WS: Socket closed, reconnecting...', event);
    reconnectSocket(...arguments);
  });
}

async function connectSocket(timerKey) {
  try {
    socket = new WebSocket(`${getUrl()}${timerKey}`);
    window.socket = socket;
    attachSocketListeners(...arguments);
    return true;
  }
  catch (err) {
    console.error('WS: connection failed', err);
    return false;
  }
}

function sendMessage(eventName, data) {
  if (socket?.readyState !== 1) {
    return false;
  }
  try {
    socket.send(JSON.stringify([eventName, data]));
    return true;
  }
  catch (err) {
    console.error(err);
  }
  return false;
}

function disconnectSocket(code = STATUS_NO_RECONNECT) {
  socket?.close(code);
  cancelReconnect();
}

function reconnectSocket() {
  if (socket) {
    cancelReconnect();
    return;
  }
  reconnectAttempts++;
  console.info('WS: Attempting to reconnect ', reconnectAttempts);
  reconnectTimeout = setTimeout(async () => {
    if (!await connectSocket(...arguments)) {
      reconnectSocket(...arguments);
    }
  }, Math.min(reconnectMaxIntervalSeconds, Math.pow(reconnectAttempts, reconnectBackoffFactor)) * 1000);
}

function cancelReconnect() {
  reconnectAttempts = 0;
  clearTimeout(reconnectTimeout);
}
