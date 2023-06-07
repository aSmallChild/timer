import {createSignal, onCleanup, Show} from 'solid-js';
import useSocket from '~/socket.js';

export function createTimer(timerKey = null) {
  const [workTimeSeconds, setWorkTimeSeconds] = createSignal(45);
  const [restTimeSeconds, setRestTimeSeconds] = createSignal(15);
  const [laps, setLaps] = createSignal(0);
  const [time, setTime] = createSignal(0);
  const [isWork, setWork] = createSignal(false);
  const [interval, setTimeInterval] = createSignal(null);

  const {connectSocket, sendMessage, disconnectSocket} = useSocket(timerKey, {
    handler(event, data) {
      if (event === 'state') {
        receiveState(data);
      }
    }
  });

  if (timerKey) {
    connectSocket(timerKey);
  }

  onCleanup(() => {
    clearInterval(interval());
    disconnectSocket();
  });

  // const tests = [{
  //     in: {workTimeSeconds: 10, restTimeSeconds: 5, time: 3, laps: 1, isWork: true, isPaused: false, clientSentTimestamp: Date.now() - 10},
  //     out: {time: 3, laps: 2, isWork: false, isPaused: false}
  //   }, {
  //     in: {workTimeSeconds: 10, restTimeSeconds: 5, time: 3, laps: 1, isWork: false, isPaused: false, clientSentTimestamp: Date.now() - 10},
  //     out: {time: 8, laps: 1, isWork: true, isPaused: false}
  //   },
  // ];

  function sendState() {
    sendMessage('state', {
      workTimeSeconds: workTimeSeconds(),
      restTimeSeconds: restTimeSeconds(),
      time: time(),
      laps: laps(),
      isPaused: paused(),
      isWork: isWork(),
      clientSentTimestamp: Date.now()
    });
  }

  function receiveState(data) {
    setWorkTimeSeconds(data.workTimeSeconds);
    setRestTimeSeconds(data.restTimeSeconds);
    const sentTime = data?.clientSentTimestamp ?? data?.serverSentTimestamp ?? Date.now();
    const secondsElapsed = data.time + Math.floor((Date.now() - sentTime) / 1000) + (data.isWork ? restTimeSeconds() : 0);
    const lapTime = workTimeSeconds() + restTimeSeconds();
    let newTime = secondsElapsed % (lapTime);
    if (newTime > restTimeSeconds()) {
      newTime -= restTimeSeconds();
      setWork(true);
    }
    else {
      setWork(false);
    }
    setTime(newTime);
    setLaps(data.laps + Math.floor(secondsElapsed / lapTime));
    if (data.isPaused !== paused()) {
      startStop(true);
    }
  }

  function zeroPaddedTimer() {
    const maxTime = Math.max(workTimeSeconds(), restTimeSeconds()) + '';
    return (time() + '').padStart(maxTime.length, '0');
  }

  function backgroundClass() {
    if (!isWork() || paused()) {
      return 'stop';
    }
    return 'go';
  }

  function paused() {
    return !interval();
  }

  function startStop(isReceivedState = false) {
    interval() ? stopTimer() : startTimer();
    if (!isReceivedState) {
      sendState();
    }
  }

  function startTimer() {
    setTimeInterval(setInterval(() => {
      setTime(time() + 1);
      if (!isWork() && time() > restTimeSeconds()) {
        setWork(true);
        setTime(1);
      }
      if (isWork() && time() > workTimeSeconds()) {
        setWork(false);
        setTime(1);
        setLaps(laps() + 1);
      }
    }, 1000));
  }

  function stopTimer() {
    clearInterval(interval());
    setTimeInterval(null);
  }

  function resetTimer() {
    setTime(0);
    setLaps(0);
    setWork(false);
    sendState();
  }


  function Timer() {
    return (
      <div class="timer" onClick={() => startStop()}>
        <div>
          <Show when={!paused()} fallback={<div class="play"></div>}>
            <span>{zeroPaddedTimer}</span>
          </Show>
          <sub>{laps}</sub>
        </div>
      </div>
    );
  }

  function Form() {
    return (
      <div class="controls">
        <div>
          <label>
            Work:
            <input type="number" step="1" min="1"
                   value={workTimeSeconds()}
                   onInput={(e) => {
                     setWorkTimeSeconds(Math.max(0, e.currentTarget.value));
                     sendState();
                   }}
            />
          </label>
          <label>
            Rest:
            <input type="number" step="1" min="1"
                   value={restTimeSeconds()}
                   onInput={(e) => {
                     setRestTimeSeconds(Math.max(0, e.currentTarget.value));
                     sendState();
                   }}
            />
          </label>
        </div>
        <button onClick={resetTimer}>Reset</button>
      </div>
    );
  }

  return {
    Timer() {
      return (
        <main classList={{[backgroundClass()]: true}}>
          <Show when={paused()}>
            <Form/>
          </Show>
          <Timer/>
        </main>
      );
    }
  };
}
