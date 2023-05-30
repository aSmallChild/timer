import {Title} from 'solid-start';
import {createSignal, Show} from 'solid-js';

const [workTimeSeconds, setWorkTimeSeconds] = createSignal(45);
const [restTimeSeconds, setRestTimeSeconds] = createSignal(15);
const [laps, setLaps] = createSignal(0);
const [time, setTime] = createSignal(0);
const [go, setGo] = createSignal(false);
const [interval, setTimeInterval] = createSignal(null);

function zeroPaddedTimer() {
  const maxTime = Math.max(workTimeSeconds(), restTimeSeconds()) + '';
  return (time() + '').padStart(maxTime.length, '0');
}

function backgroundClass() {
  if (!go() || paused()) {
    return 'stop';
  }
  return 'go';
}

function paused() {
  return !interval();
}


function startStop() {
  interval() ? stopTimer() : startTimer();
}

function startTimer() {
  setTimeInterval(setInterval(() => {
    setTime(time() + 1);
    if (!go() && time() > restTimeSeconds()) {
      setGo(true);
      setTime(1);
    }
    if (go() && time() > workTimeSeconds()) {
      setGo(false);
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
  setGo(true);
}

export default function Home() {
  return (
    <main classList={{[backgroundClass()]: true}}>
      <Title>Timer</Title>
      <Show when={paused()}>
        <Form/>
      </Show>
      <Timer/>
    </main>
  );
}

function Timer() {
  return (
    <div class="timer" onClick={startStop}>
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
        <label>Work: <input value={workTimeSeconds()} onInput={(e) => setWorkTimeSeconds(e.currentTarget.value)}/></label>
        <label>Rest: <input value={restTimeSeconds()} onInput={(e) => setRestTimeSeconds(e.currentTarget.value)}/></label>
      </div>
      <button onClick={resetTimer}>Reset</button>
    </div>
  );
}
