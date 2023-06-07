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
    const timeStore = env.WO_TIME_STORE.get(env.WO_TIME_STORE.idFromName(key));
    return timeStore.fetch(new Request(`https://.../${key}`, request.clone()));
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

// noinspection JSUnusedGlobalSymbols
export class TimeStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.timerState = {
      workTimeSeconds: 45,
      restTimeSeconds: 15,
      time: 1,
      laps: 0,
      isPaused: true,
      isWork: false,
      clientSentTimestamp: Date.now()
    };
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
    this.onSession(session);

    setImmediate(() => {
      console.log('Accepting session...');
      session.send(['session:accepted', null]);
    });

    return response;
  }

  onSession(session) {
    this.sessions.push(session);
    session.onClose(() => {
      const index = this.sessions.indexOf(session);
      if (index !== -1) this.sessions.splice(index, 1);
    });

    session.send(['state', this.timerState]);
    session.onMessage((event, data) => {
      if (event === 'state') {
        data.serverReceivedTimestamp = Date.now();
        this.timerState = data;
        this.broadcastState(session);
      }
    });
  }

  broadcastState(excludeSession) {
    try {
      for (const session of this.sessions) {
        if (session === excludeSession) {
          continue;
        }
        session.send(['state', {...this.timerState, serverSentTimestamp: Date.now()}]);
      }
    }
    catch (err) {
      console.error('error while broadcasting state', err.message, err.stack);
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

        const parsedEvent = JSON.parse(message.data);
        if (parsedEvent?.constructor !== Array) {
          console.error('error while parsing socket message', message.data);
          return;
        }

        this.lastMessageTime = Date.now();
        const [event, data] = parsedEvent;
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
      console.error('failed to send message to socket', err.message, err.stack);
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
          console.error('Error while calling socket onClose handler', err.message, err.stack);
        }
      });
    }
    catch (err) {
      console.error('error while closing socket', err.message, err.stack);
    }
  }

  close(code, reason) {
    if (this.quit) return;
    this.socket.close(code, reason);
    this.#handleClose();
  }
}