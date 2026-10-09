import { BUILT_BY, PROJECT_NAME } from "../config";

export function Hero() {
  return (
    <header className="hero" id="top">
      <h1>{PROJECT_NAME}</h1>
      <p>{BUILT_BY}</p>
    </header>
  );
}
