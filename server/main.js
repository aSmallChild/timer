const sessionHealthCheckIntervalMs = 60000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const original = await handleRequest(request, env);
    const response = new Response(original.body, original);
    response.headers.set('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Headers', '*');
    return response;
  },
};

async function handleRequest(request, env) {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204});
    }
    const url = new URL(request.url);
    const key = url.pathname.substring(1);
    const timeStore = env.DO_TIME_STORE.get(env.DO_TIME_STORE.idFromName(key));
    return timeStore.fetch(new Request(`https://.../`, request));
  }
  catch (err) {
    console.error(`Failed to handle request ${request.method} ${request.url}`, err.message, err.stack);
    return jsonResponse({message: 'internal error'}, 500);
  }
}

function createSession() {
  const {0: client, 1: server} = new WebSocketPair();
  server.accept();
  return [new Response(null, {status: 101, webSocket: client}), new Session(server)];
}

function jsonResponse(data, status = 200) {
  data.success = status >= 200 && status < 300;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json;charset=UTF-8',
    },
  });
}

export class TimeStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.startTimestamp = null;
    this.workTimeSeconds = 45;
    this.restTimeSeconds = 15;
    this.sessions = [];
  }

  async fetch(request) {
    if (request.method != 'GET') {
      return jsonResponse({message: 'bad method'}, 405);
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader !== 'websocket') {
      return jsonResponse({message: 'bad upgrade'}, 426);
    }

    const [response, session] = createSession();
    session.send(['session:accepted', null]);
    this.onSession(session);

    return response;
  }

  get currentState() {
    return {
      startTimestamp: this.startTimestamp,
      workTimeSeconds: this.workTimeSeconds,
      restTimeSeconds: this.restTimeSeconds,
    };
  }

  onSession(session) {
    this.sessions.push(session);
    session.onClose(() => {
      const index = this.sessions.indexOf(session);
      if (index !== -1) this.sessions.splice(index, 1);
    });

    session.send(['state', this.currentState]);
    session.onMessage((event, data) => {
      if (event === 'state') {
        this.startTimestamp = data.startTimestamp;
        this.workTimeSeconds = data.workTimeSeconds;
        this.restTimeSeconds = data.restTimeSeconds;
        this.broadcastState();
      }
    });
  }

  broadcastState() {
    const state = this.currentState;
    for (const session of this.sessions) {
      session.send(['state', state]);
    }
  }
}

class Session {
  #quit = false;
  #onMessage;
  #onClose = [];

  constructor(socket) {
    this.socket = socket;
    this.lastMessageTime = Date.now();
    this.messageCheckInterval = setInterval(() => {
      if (Date.now() - this.lastMessageTime > sessionHealthCheckIntervalMs) {
        this.ping();
      }
    }, sessionHealthCheckIntervalMs);

    socket.addEventListener('message', message => {
      try {
        if (this.quit) {
          socket.close(1011, 'WebSocket broken.');
          return;
        }
        this.lastMessageTime = Date.now();
        const [event, data] = JSON.parse(message.data);
        if (event == 'ping') {
          const now = Date.now();
          this.emit('pong', {then: data, now, diff: now - data});
          return;
        }

        if (this.#onMessage) this.#onMessage(event, data);
      }
      catch (err) {
        console.error('error while handling socket message', err.message, err.stack);
      }
    });

    socket.addEventListener('close', () => this.#handleClose());
    socket.addEventListener('error', () => this.#handleClose());
  }

  get quit() {
    return this.#quit;
  }

  onClose(callback) {
    this.#onClose.push(callback);
  }

  onMessage(callback) {
    this.#onMessage = callback;
  }

  ping() {
    this.emit('ping', Date.now());
  }

  emit(event, data) {
    this.send([event, data]);
  }

  send(data) {
    try {
      if (this.quit) return;
      if (typeof data !== 'string') data = JSON.stringify(data);
      this.socket.send(data);
      this.lastMessageTime = Date.now();
    }
    catch (err) {
      console.error('failed to send message to socket');
      console.error(err.message);
      this.#handleClose();
    }
  }

  #handleClose() {
    try {
      if (this.quit) return;
      clearInterval(this.messageCheckInterval);
      this.#quit = true;
      this.#onClose.forEach(cb => {
        try {
          cb();
        }
        catch (err) {
          console.error('Error while calling socket onClose handler', err);
        }
      });
    }
    catch (err) {
      console.error('error while closing socket');
      console.error(err.message);
    }
  }

  close(code, reason) {
    if (this.quit) return;
    this.socket.close(code, reason);
    this.#handleClose();
  }
}