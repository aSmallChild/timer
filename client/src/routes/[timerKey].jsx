import {Title} from 'solid-start';
import {createTimer} from '../timer.jsx';
import { useParams } from "solid-start";

export default function AwayFromHome() {
  const params = useParams();
  const {Timer} = createTimer(params.timerKey);
  return [
    <Title>Timer - {params.timerKey}</Title>,
    <Timer/>
  ];
}