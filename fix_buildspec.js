const { AmplifyClient, UpdateAppCommand } = require("@aws-sdk/client-amplify");

const amplify = new AmplifyClient({ region: "ap-south-1" });

const buildSpec = `version: 1
applications:
  - frontend:
      phases:
        preBuild:
          commands:
            - yum install -y libatomic
            - npm install -g pnpm
            - pnpm install
        build:
          commands:
            - pnpm --filter towfleet-web build
      artifacts:
        baseDirectory: apps/towfleet-web/.next
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
    appRoot: apps/towfleet-web`;

async function run() {
  const params = {
    appId: "d27sv0mejh5ynx",
    buildSpec: buildSpec
  };

  try {
    const data = await amplify.send(new UpdateAppCommand(params));
    console.log("Successfully updated build spec!");
  } catch (err) {
    console.error(err);
  }
}

run();
