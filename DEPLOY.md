# Deploying MØIST to AWS

A step-by-step guide for Windows (PowerShell). Follow the steps in order. It takes about an hour the first time; most of that is installing tools and waiting for CloudFront.

You will end up with:

```
 Glove ──USB──> Laptop gateway ──HTTPS──> API Gateway ──> Lambda ──> DynamoDB
                     ▲                                     │  ├──> LLM (OpenRouter / Bedrock)
                     │                                     │  └──> SNS (e-mail alerts)
                     └──── ngrok tunnel <── GET /status ───┘
                                                    EventBridge (06:30 brief) ──> Lambda
 Browser ──> CloudFront ──> S3 (dashboard)  ──── reads from API Gateway
```

**Why ngrok?** Readings travel *from* the laptop *to* AWS as ordinary HTTPS requests, so they need no tunnel. ngrok solves the reverse direction: AWS cannot reach a laptop behind Wi-Fi. The gateway runs a small read-only status page (`/status` on port 8790). ngrok gives it a public HTTPS address, and the Lambda reads it, so the hosted dashboard shows "Gateway online · glove plugged in" in real time. If ngrok is not running, everything else still works and the sidebar shows "Gateway offline".

---

## 0. Values you will collect

Keep a scratch note with these. You fill them in as you go.

| Name | Where it comes from | Example |
|---|---|---|
| `WRITE_API_KEY` | you generate it (step 4) | `x3F...` (32 chars) |
| `GATEWAY_TOKEN` | you generate it (step 4) | `pQ9...` |
| `NGROK_URL` | ngrok dashboard (step 3) | `https://lovekesh-moist.ngrok-free.app` |
| `ApiUrl` | output of `sam deploy` (step 5) | `https://abc123.execute-api.ap-south-1.amazonaws.com` |
| `DashboardUrl` | output of `sam deploy` | `https://d1xyz.cloudfront.net` |
| `SiteBucketName` | output of `sam deploy` | `moist-sitebucket-1a2b3c` |
| `DistributionId` | output of `sam deploy` | `E2ABCDEF123456` |

Never commit the secrets (the two generated ones and your OpenRouter keys). `samconfig.toml` and `backend/.env` store them and are already in `.gitignore`.

---

## 1. Install the tools

Open PowerShell and run:

```powershell
winget install Amazon.AWSCLI
winget install Amazon.SAM-CLI
winget install OpenJS.NodeJS.LTS      # skip if `node -v` already works
pip install pyserial
```

Close and reopen PowerShell, then check:

```powershell
aws --version      # aws-cli/2.x
sam --version      # SAM CLI, version 1.x
python --version   # must be 3.14: the Lambda runtime in backend/template.yaml is python3.14
node -v
ngrok version      # already installed on this laptop
```

`sam build` uses your local Python to build the function, so it must match the Lambda runtime. If you only have a different Python, change `Runtime:` in `backend/template.yaml` to match it (python3.12, 3.13 or 3.14).

## 2. AWS account and credentials

1. Sign in to the AWS console with your account. Pick the **Asia Pacific (Mumbai) ap-south-1** region (top right).
2. **Set a budget alarm first:** Billing and Cost Management → Budgets → Create budget → *Monthly cost budget* → amount `10` USD → your e-mail.
3. Create a deploy user: IAM → Users → **Create user** → name `moist-deployer` → *Attach policies directly* → `AdministratorAccess` → Create.
   Open the user → Security credentials → **Create access key** → *Command Line Interface (CLI)* → copy the key ID and secret.
4. Configure the CLI:

   If PowerShell says `aws` is not recognized right after installing, open a new window or call it by its full path:
   `& "C:\Program Files\Amazon\AWSCLIV2\aws.exe" configure` (note the `&`).

   ```powershell
   aws configure
   # AWS Access Key ID:     <key id>
   # AWS Secret Access Key: <secret>
   # Default region name:   ap-south-1
   # Default output format: json
   aws sts get-caller-identity     # prints your account number = it works
   ```

   Delete this access key after the hackathon (IAM → user → Security credentials → Deactivate/Delete).

## 3. AI provider: OpenRouter keys (Bedrock as fallback)

The morning brief and the AI assistant page call a large language model from the Lambda. The model only turns figures the system has already computed into plain language; it never classifies waste. `backend/src/brief.py` tries, in order:

1. **OpenRouter**, once per key in the `OpenRouterKeys` parameter (comma-separated). If a key is rate-limited or out of credit, the next key is tried. Each call names three free models, and OpenRouter falls back across them: `nvidia/nemotron-3-super-120b-a12b:free`, then `google/gemma-4-31b-it:free`, then `google/gemma-4-26b-a4b-it:free`.
2. **Amazon Bedrock**, Amazon Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`), when the account has Bedrock quota.
3. A **rule-based brief**, so the dashboard always shows something. Questions return "AI busy" instead.

**Get OpenRouter keys:** sign in at <https://openrouter.ai> → **Keys** → **Create key**. Free-tier keys work with `:free` models but are rate-limited (about 50 requests a day per key without credit), so add two or three keys, or put a few dollars of credit on one.

**Bedrock (optional):** new AWS accounts often have a Bedrock token quota of **0**. Check: Service Quotas → Amazon Bedrock → search *Nova 2 Lite*. If *Cross-region model inference tokens per minute* is 0, click **Request increase**. If the daily-token quota is also 0, open a Support case (*Service limit increase → Amazon Bedrock*). Nothing needs redeploying once the quota is raised.

## 3b. ngrok address

Free ngrok accounts get one fixed domain, so the address stays the same between restarts.

1. Sign in at <https://dashboard.ngrok.com> and run the `ngrok config add-authtoken ...` command it shows (this laptop already has one; check with `ngrok config check`).
2. Run `ngrok http 8790` once. The `Forwarding` line shows your address, e.g. `https://something.ngrok-free.dev`. That is `NGROK_URL`.

## 4. Generate the two secrets

```powershell
python -c "import secrets; print(secrets.token_urlsafe(24))"    # -> WRITE_API_KEY
python -c "import secrets; print(secrets.token_urlsafe(24))"    # -> GATEWAY_TOKEN
```

`WRITE_API_KEY` lets the gateway post readings. `GATEWAY_TOKEN` lets AWS read the gateway's status page through ngrok, and nobody else can.

## 5. Deploy the backend (API, Lambda, DynamoDB, Bedrock, SNS, EventBridge, S3, CloudFront)

```powershell
cd D:\moist\backend
sam build
sam deploy --guided
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| Stack Name | `moist` |
| AWS Region | `ap-south-1` |
| Parameter WriteApiKey | your `WRITE_API_KEY` |
| Parameter AlertEmail | your e-mail (for fault alerts and the 06:30 brief), or leave empty |
| Parameter BedrockRegion | `us-east-1` (press Enter) |
| Parameter OpenRouterKeys | your OpenRouter keys, comma-separated (input is hidden) |
| Parameter GatewayUrl | your `NGROK_URL`, e.g. `https://lovekesh-moist.ngrok-free.app` |
| Parameter GatewayToken | your `GATEWAY_TOKEN` |
| Confirm changes before deploy | `y` |
| Allow SAM CLI IAM role creation | `y` |
| Disable rollback | `n` |
| ApiFunction has no authentication. Is this okay? | `y` (writes are protected by the API key inside the function) |
| Save arguments to configuration file | `y` |
| SAM configuration file / environment | press Enter twice |

When it asks *Deploy this changeset?*, type `y`. It takes 3–6 minutes (CloudFront is the slow part). At the end, copy the **Outputs**: `ApiUrl`, `DashboardUrl`, `SiteBucketName`, `DistributionId`.

Check the API:

```powershell
curl.exe "<ApiUrl>/health"          # {"ok": true, ...}
```

If you set an `AlertEmail`, open your inbox and click **Confirm subscription** in the mail from AWS Notifications.

## 6. Put the dashboard on S3 + CloudFront

```powershell
cd D:\moist\web
Set-Content -Encoding ascii .env.production "VITE_API_URL=<ApiUrl>"
npm install
npm run build
aws s3 sync dist s3://<SiteBucketName> --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

Open `DashboardUrl` in the browser. The first load after a new distribution can take a few minutes.

## 7. Optional: demo history

The real glove gives you one collection point. To show the map, ranking and trends with several areas, load 30 days of simulated history. The dashboard labels it "simulated":

```powershell
cd D:\moist
python backend/seed.py --api <ApiUrl> --key <WRITE_API_KEY>
```

## 8. Connect the glove to AWS (gateway + ngrok)

Plug in the glove and **close the Arduino IDE Serial Monitor** (it locks COM5). Then use two PowerShell windows.

**Window 1: gateway**

Put the three values in `gateway/.env` once (gitignored; copy `gateway/.env.example`):

```
MOIST_API=<ApiUrl>
MOIST_API_KEY=<WRITE_API_KEY>
MOIST_GATEWAY_TOKEN=<GATEWAY_TOKEN>
```

Then:

```powershell
cd D:\moist
python gateway/gateway.py --port COM5 --area-id demo-bench --area-name "Demo bench" --lat 28.6139 --lon 77.2090
```

You should see `API ok`, `status on http://localhost:8790/status` and `glove connected on COM5`. Every reading prints a line like `dry  score=0.12  raw=968`.
Change `--lat/--lon` to where you demo; that is where the point appears on the map.

**Window 2: ngrok**

```powershell
ngrok http --url=<NGROK_URL> 8790
```

**Check it:** open `<ApiUrl>/gateway` in the browser. You should see `"online": true, "glove_connected": true`. The dashboard sidebar then reads *Gateway online · glove plugged in*.

If the Wi-Fi drops, readings wait in `gateway/outbox.jsonl` and are sent automatically when the connection returns.

## 9. Final check before judging

Open `DashboardUrl` and go through this list:

- [ ] **Landing page** loads over HTTPS from CloudFront.
- [ ] **Live sorting:** tick *Real glove only* and take a reading. It appears within about 2 seconds.
- [ ] **AI assistant:** ask "Which collection point should go to the energy plant?" The answer shows the model that wrote it (e.g. `nvidia/nemotron-3-super-120b-a12b:free`).
- [ ] **Morning brief → Regenerate:** the footer says *Written by AI · <model>* (it can take up to 25 seconds on free models).
- [ ] **Sidebar:** *Gateway online · glove plugged in*.
- [ ] **Fault alert:** touch both probe contacts to a metal spoon. The reading is flagged *Probe shorted (metal?)*, appears under **Alerts**, and you get an e-mail.
- [ ] **Scheduled brief:** run it now instead of waiting for 06:30:
  ```powershell
  cd D:\moist\backend
  sam remote invoke ApiFunction --stack-name moist --event "{}"
  ```

Logs, if something misbehaves:

```powershell
sam logs -n ApiFunction --stack-name moist --tail
```

## 10. Updating later

| What changed | Run |
|---|---|
| Backend code (`backend/src`) | `cd backend; sam build; sam deploy` (no `--guided`; answers are saved in `samconfig.toml`) |
| Dashboard (`web/src`) | `cd web; npm run build; aws s3 sync dist s3://<SiteBucketName> --delete; aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"` |
| ngrok address or a secret | `sam deploy --guided` again and change only that answer |

## 11. Costs

At hackathon volume almost everything stays inside the AWS free tier (Lambda, API Gateway, DynamoDB on-demand, S3, CloudFront, SNS e-mail, EventBridge). The AI runs on OpenRouter's free models, which cost nothing (Bedrock Nova 2 Lite, if enabled, is a small fraction of a cent per call). Questions are capped at 60 per hour (`ASK_PER_HOUR` in `app.py`), and *Regenerate* at one call per minute. The budget alarm from step 2 warns you well before anything matters.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `sam build`: *Binary validation failed for python* | Your Python version differs from `Runtime:` in `template.yaml`. Make them match, or run `sam build --use-container` with Docker Desktop. |
| Dashboard loads but shows *Failed to fetch* | `web/.env.production` has the wrong `ApiUrl` (no trailing `/`). Rebuild, sync and invalidate again. |
| Gateway prints `401` / `Missing or invalid x-api-key` | `MOIST_API_KEY` differs from the `WriteApiKey` you deployed. |
| Gateway: `could not open port 'COM5'` | The glove is unplugged, the Serial Monitor is open, or the port changed. Check Device Manager → Ports. |
| AI page: *The AI service is busy* | Every OpenRouter key is rate-limited and Bedrock has no quota (step 3). Wait a minute, add a key, or add credit. Details: `sam logs -n ApiFunction --stack-name moist`. |
| Brief footer says *Rule-based summary* | Same as above. Click *Regenerate* later. |
| Sidebar: *Gateway offline* | ngrok is not running, the URL differs from `GatewayUrl`, or the token differs from `GatewayToken`. |
| No alert e-mails | The SNS subscription was not confirmed. Check spam for the AWS mail. |

## 13. Tear down after the event

```powershell
aws s3 rm s3://<SiteBucketName> --recursive     # a bucket must be empty before it can be deleted
cd D:\moist\backend
sam delete --stack-name moist
```

Then deactivate the `moist-deployer` access key in IAM.

---

### What runs where

| AWS service | Job in MØIST |
|---|---|
| **API Gateway** (HTTP API) | Public HTTPS endpoint for the gateway and the dashboard; throttled to 25 req/s |
| **Lambda** (Python 3.14, arm64) | Validates and classifies readings, computes the Energy Suitability Index and actions, serves all dashboard data, calls the LLM, reads the gateway status through ngrok |
| **DynamoDB** | `Readings` (by area and time, plus a by-day index), `Areas`, `State` (action queue, latest brief, question counter) |
| **Amazon Bedrock** | Fallback LLM (Amazon Nova 2 Lite) for the brief and questions when OpenRouter is unavailable |
| **EventBridge Scheduler** | Runs the morning brief every day at 06:30 IST |
| **SNS** | E-mails fault alerts (shorted probe, gas spike) and the morning brief |
| **S3 + CloudFront** | Hosts the dashboard privately over HTTPS (Origin Access Control, PriceClass_200 incl. India) |
| **CloudFormation** (SAM) | Creates and deletes the whole stack from `backend/template.yaml` |
| **CloudWatch Logs** | Lambda logs and errors, kept 7 days |
| **IAM** | Least-privilege role for the Lambda (its tables, its topic, Bedrock) |
