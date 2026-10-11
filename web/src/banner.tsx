import { createRoot } from "react-dom/client";
import glove from "./assets/glove.webp";
import SkyGradient from "./components/SkyGradient";
import { Logo } from "./components/ui";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <div className="banner">
    <SkyGradient style={{ aspectRatio: "auto", height: "100%", position: "absolute", inset: 0 }} paused />
    <div className="banner-text">
      <Logo />
      <h1>A glove that sorts wet waste from dry</h1>
      <p>Moisture sensing at pick-up · Waste-to-energy dashboard · Built on AWS</p>
    </div>
    <img src={glove} alt="" />
  </div>,
);
