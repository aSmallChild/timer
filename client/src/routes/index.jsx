import {Title} from 'solid-start';
import {createTimer} from '../timer.jsx';

export default function Home() {
  const {Timer} = createTimer();
  return [<Title>Timer</Title>, <Timer/>];
}