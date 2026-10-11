import { num, pct, usePoll, type Live, type Overview } from "../api";
import SkyGradient from "../components/SkyGradient";
import { ClassPill, Icon, Logo, MoistureBar, StatusBadge, type IconName } from "../components/ui";
import glove from "../assets/glove.webp";
import meadow from "../assets/meadow.webp";

const STEPS = [
  { t: "Approach", d: "An ultrasonic sensor measures the distance to the item. The wrist display counts down to 10 as the glove gets into range." },
  { t: "Measure", d: "A servo lowers a two-contact probe onto the item and reads its conductivity seven times. Wet material conducts; dry material does not." },
  { t: "Sort", d: "A green, red or amber LED gives the result in under a second. The worker places the item without handling it." },
  { t: "Report", d: "The reading is sent to AWS with the time and collection point, and the area statistics update." },
];

const MORE: { icon: IconName; t: string; d: string }[] = [
  { icon: "spark", t: "AI assistant", d: "An LLM, called from AWS Lambda, writes a 06:30 brief for the ward officer and answers questions such as \"Which area needs a segregation drive?\" from the computed figures." },
  { icon: "alert", t: "Fault detection", d: "Readings from a shorted probe or a gas spike are flagged, excluded from the statistics and sent by e-mail." },
  { icon: "factory", t: "Plant routing", d: "Collection points with a high Energy Suitability Index are queued for direct transport to the waste-to-energy plant." },
];

const AWS = [
  ["API Gateway", "HTTPS endpoint"],
  ["Lambda", "Classification and analytics"],
  ["DynamoDB", "Readings, areas, actions"],
  ["Bedrock + OpenRouter", "AI brief and questions"],
  ["EventBridge Scheduler", "Daily jobs"],
  ["SNS", "Alerts by e-mail"],
  ["S3 + CloudFront", "Dashboard hosting"],
  ["CloudWatch", "Logs and metrics"],
];

function scrollTo(id: string) {
  return (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); };
}

export default function Landing() {
  const { data } = usePoll<Overview>("/overview?range=7d", 15000);
  const live = usePoll<Live>("/live?since=0", 15000);
  const k = data?.kpis;
  const latest = live.data?.readings[0];
  const top = data ? [...data.areas].filter((a) => a.stats.count).sort((a, b) => b.stats.esi - a.stats.esi).slice(0, 4) : [];

  return (
    <div className="landing">
      <header className="l-nav">
        <Logo />
        <nav className="l-links">
          <a href="#how" onClick={scrollTo("how")}>How it works</a>
          <a href="#product" onClick={scrollTo("product")}>Product</a>
          <a href="#aws" onClick={scrollTo("aws")}>Architecture</a>
          <a href="#/app/ai">AI assistant</a>
        </nav>
        <a className="btn btn-outline btn-sm" href="#/app/overview">Open dashboard</a>
      </header>

      <section className="l-hero">
        <SkyGradient style={{ aspectRatio: "auto", height: "100%", position: "absolute", inset: 0 }} speed={16} />
        <img className="l-hero-glove" src={glove} alt="The MØIST prototype: an Arduino, LED matrix and moisture probe mounted on a work glove" />
        <div className="l-hero-inner">
          <div className="l-hero-text">
            <span className="l-tag">Environmental Hacks · Waste &amp; Energy</span>
            <h1>A glove that sorts wet waste from dry</h1>
            <p>
              A probe on the glove measures the moisture of an item before the worker touches it, and shows wet or
              dry in under a second. Every reading is sent to AWS, so the city can see which collection points
              produce waste that is dry enough to burn for energy.
            </p>
            <div className="l-cta">
              <a className="btn btn-dark" href="#/app/overview">Open dashboard <Icon name="arrow" size={16} /></a>
              <a className="btn btn-text" href="#how" onClick={scrollTo("how")}>How it works</a>
            </div>
          </div>
        </div>
      </section>

      <section className="l-stats">
        <div><strong>{k ? num(k.checks) : "–"}</strong><span>Items checked, last 7 days</span></div>
        <div><strong>{k ? pct(k.dryShare) : "–"}</strong><span>Classified dry</span></div>
        <div><strong>{k ? k.areas : "–"}</strong><span>Collection points reporting</span></div>
        <div><strong>{k ? k.esi.toFixed(0) : "–"}</strong><span>Average Energy Suitability Index</span></div>
      </section>

      <section className="l-section l-split">
        <div>
          <span className="eyebrow">The problem</span>
          <h2>Mixed waste is hard to burn and hard to measure.</h2>
          <p className="l-lead">
            Sorting at collection points is done by sight, smell and hand. It exposes workers to health risks
            and produces no record of how well each area segregates.
          </p>
        </div>
        <dl className="l-facts">
          <div><dt>50–55%</dt><dd>Share of Indian municipal solid waste that is wet. Mixed in, it soaks the dry fraction.</dd></div>
          <div><dt>41–52%</dt><dd>Typical moisture of Indian city waste, often above what waste-to-energy plants can burn efficiently.</dd></div>
          <div><dt>4 streams</dt><dd>Required by the Solid Waste Management Rules 2026, with online tracking of how waste is handled.</dd></div>
        </dl>
      </section>

      <section className="l-section l-how" id="how">
        <img className="meadow" src={meadow} alt="" aria-hidden />
        <span className="eyebrow">How it works</span>
        <h2>From one item to a ward-level plan</h2>
        <ol className="l-steps">
          {STEPS.map((s, i) => (
            <li key={s.t}>
              <span className="l-step-n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="l-section" id="product">
        <span className="eyebrow">Product</span>
        <h2>Two views for two decisions</h2>
        <div className="l-product">
          <article className="l-prod">
            <div className="l-prod-text">
              <h3>Live sorting</h3>
              <p>Every reading appears within two seconds, with its moisture score, certainty and the glove that took it. Supervisors see which gloves are online.</p>
              <a className="link" href="#/app/live">Open live sorting <Icon name="arrow" size={14} /></a>
            </div>
            <div className="l-mock">
              {latest ? (
                <>
                  <div className="l-mock-head"><span className="eyebrow">Latest reading</span><ClassPill cls={latest.class} /></div>
                  <div className="l-mock-big">{latest.moisture_score.toFixed(2)}<span>moisture score</span></div>
                  <MoistureBar value={latest.moisture_score} />
                  <div className="l-mock-foot"><span>{latest.area_id}</span><span>{pct(latest.certainty)} certain</span></div>
                </>
              ) : <div className="l-mock-empty">Waiting for the first reading</div>}
            </div>
          </article>
          <article className="l-prod">
            <div className="l-prod-text">
              <h3>Energy planner</h3>
              <p>Collection points are ranked by an Energy Suitability Index built from dry share and mean moisture, and each gets one recommended action.</p>
              <a className="link" href="#/app/energy">Open energy planner <Icon name="arrow" size={14} /></a>
            </div>
            <div className="l-mock">
              <div className="l-mock-head"><span className="eyebrow">Top collection points, 7 days</span></div>
              {top.length ? (
                <ul className="l-mock-list">
                  {top.map((a) => (
                    <li key={a.id}>
                      <span className="l-mock-name">{a.name}</span>
                      <span className="mono">{a.stats.esi.toFixed(0)}</span>
                      <StatusBadge status={a.stats.status} />
                    </li>
                  ))}
                </ul>
              ) : <div className="l-mock-empty">No rated areas yet</div>}
            </div>
          </article>
        </div>
        <div className="l-more">
          {MORE.map((m) => (
            <div key={m.t}>
              <span className="l-ficon"><Icon name={m.icon} size={18} /></span>
              <h4>{m.t}</h4>
              <p>{m.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section" id="aws">
        <span className="eyebrow">Architecture</span>
        <h2>Serverless on AWS</h2>
        <p className="l-lead">Glove → USB gateway → API Gateway → Lambda → DynamoDB → dashboard. A single SAM template deploys the stack.</p>
        <div className="l-aws">
          {AWS.map(([n, d]) => <div key={n}><strong>{n}</strong><span>{d}</span></div>)}
        </div>
      </section>

      <section className="l-final">
        <SkyGradient style={{ aspectRatio: "auto", height: "100%", position: "absolute", inset: 0 }} speed={12} />
        <div className="l-final-inner">
          <h2>See the live feed</h2>
          <p>Readings from the prototype glove and simulated collection points.</p>
          <a className="btn btn-dark" href="#/app/live">Open live sorting <Icon name="arrow" size={16} /></a>
        </div>
      </section>

      <footer className="l-foot">
        <Logo />
        <span>Lovekesh and Dua · Environmental Hacks 2026</span>
      </footer>
    </div>
  );
}
