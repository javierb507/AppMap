# Private review of one local app

Identity first, then connection. qURL uses OpenNHP for cryptographic
invisibility: the reviewer must have your approval before they can reach
the app through qURL. Your app stays on your computer, with no deployment,
public inbound app port, qURL account or domain setup needed.

This is an optional terminal workflow for reviewing an app you found in
AppMap. It does not add a Share button or replace a public webhook tunnel.

## Choose the app

Start a non-sensitive app and find its port in AppMap. Open it locally first.
Use its loopback HTTP address, for example `http://127.0.0.1:3000`.
Share that app, **not the AppMap dashboard** (port 10000 by default): the
dashboard can control processes on your machine.

Keep the app's own authentication. Close any separate public tunnel or
public listener; qURL does not close routes you opened another way.

## Start a private share

Install the [qURL CLI](https://github.com/layervai/qurl-integrations/tree/main/apps/cli#install),
version 4.4.3 or later. In another terminal, publish the chosen address:

```sh
qurl publish http://127.0.0.1:3000 --id appmap-review-1 --name "App review" --allow-requests --foreground -o json
```

Keep this terminal running. Use a new ID for each review. Check the JSON:
`private` must be `true`, `found_existing` must be `false`, and
`access_requests` must be `true`. Otherwise stop and check the resource
before sending its address.

Send the returned `resource_url` to your reviewer. They choose **Request
access**, save a passkey and give you the code shown on their screen through
a conversation you trust. In another terminal, replace `CRID` and `CODE`
with the returned CRID and the reviewer's code:

```sh
qurl approve CRID CODE
```

Ask them to choose **Open** and confirm the page and one app action work.
For a dev-server Host or Origin rejection, use the server's documented
exact-origin setting; do not disable its security checks.

## End the review

Delete the share before stopping or restarting the app, so its port cannot
be reused while access remains active. Replace `CRID` with the same CRID:

```sh
qurl delete CRID
```

Then stop the publishing command with Ctrl+C. Stopping the app alone does
not delete the resource.

[Private reviewer walkthrough](https://qurl.link/share-without-deploying?utm_source=appmap-readme&utm_medium=referral&utm_campaign=first-share-pilot)
