#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GreengrassVpceStack } from "../lib/greengrass-vpce-stack";

const app = new cdk.App();

const VPC_ID = app.node.tryGetContext("vpcId");
const SUBNET_IDS = app.node.tryGetContext("subnetIds");

new GreengrassVpceStack(app, "GreengrassVpceStack", {
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  vpcId: VPC_ID,
  subnetIds: SUBNET_IDS,
});
