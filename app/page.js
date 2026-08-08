"use client";
import Clock from "../components/Clock";
import Weather from "../components/Weather";
import News from "../components/News";
import Voice from "../components/Voice";
import Kiosk from "../components/Kiosk";
import Anime from "../components/Anime";
import Calendar from "../components/Calendar";
import Face from "../components/Face";
import Feed from "../components/Feed";
import NowPlaying from "../components/NowPlaying";

export default function Page() {
  return (
    <main className="wrap">
      <div className="row">
        <div className="col"><Clock /></div>
        <div className="col" style={{ alignItems: "flex-end" }}><Weather /></div>
      </div>
      <div className="grid3">
        <div className="panel"><Calendar /></div>
        <div className="panel panel-mid"><News /><Face /></div>
        <div className="panel"><Feed /></div>
      </div>
      <Anime />
      <NowPlaying />
      <Voice />
      <Kiosk />
    </main>
  );
}
