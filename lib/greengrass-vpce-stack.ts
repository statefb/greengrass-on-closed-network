import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as cr from "aws-cdk-lib/custom-resources";

interface GreengrassVpceStackProps extends cdk.StackProps {
  vpcId: string;
  subnetIds: string[];
}

export class GreengrassVpceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GreengrassVpceStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
      vpcId: props.vpcId,
    });

    const subnets = props.subnetIds.map((subnetId) =>
      ec2.Subnet.fromSubnetId(this, subnetId, subnetId)
    );

    // Security group for VPC Endpoint
    // NOTE: Allow all traffic from VPC for simplicity. You should restrict this to only the traffic you need.
    const sg = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic());

    // VPC Endpoint for IoT Data
    const iotDataVpcEndpoint = vpc.addInterfaceEndpoint(
      "VpcEndpointForIoTData",
      {
        // service: new ec2.InterfaceVpcEndpointAwsService("iot.data"),
        service: ec2.InterfaceVpcEndpointAwsService.IOT_CORE,
        // Currently (2023/11/08) private DNS is not supported for IoT Data endpoint
        privateDnsEnabled: false,
        securityGroups: [sg],
        subnets: { subnets },
      }
    );

    // VPC Endpoint for IoT Credentials
    const iotCredVpcEndpoint = vpc.addInterfaceEndpoint(
      "VpcEndpointForIoTCredentials",
      {
        service: new ec2.InterfaceVpcEndpointAwsService("iot.credentials"),
        // Currently (2023/11/08) private DNS is not supported for IoT Data endpoint
        privateDnsEnabled: false,
        securityGroups: [sg],
        subnets: { subnets },
      }
    );

    // VPC Endpoint for Greengrass
    vpc.addInterfaceEndpoint("VpcEndpointForGreengrass", {
      service: ec2.InterfaceVpcEndpointAwsService.IOT_GREENGRASS,
      privateDnsEnabled: true,
      securityGroups: [sg],
      subnets: { subnets },
    });

    // VPC Endpoint for S3 (Interface type)
    vpc.addInterfaceEndpoint("VpcEndpointForS3", {
      service: ec2.InterfaceVpcEndpointAwsService.S3,
      privateDnsEnabled: true,
      securityGroups: [sg],
      subnets: { subnets },
    });

    // VPC Endpoint for S3 (Gateway type)
    vpc.addGatewayEndpoint("VpcEndpointForS3Gateway", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Equivalent to: `aws iot describe-endpoint --endpoint-type iot:Data-ATS`
    const iotDataEndpoint = this.getIoTEndpointPrefix("iot:Data-ATS");
    // Equivalent to: `aws iot describe-endpoint --endpoint-type iot:CredentialProvider`
    const iotCredEndpoint = this.getIoTEndpointPrefix("iot:CredentialProvider");

    // Private DNS Zone for IoT Data / IoT Credentials
    const hostedZone = new route53.PrivateHostedZone(
      this,
      "PrivateHostedZone",
      {
        vpc,
        zoneName: `iot.${cdk.Stack.of(this).region}.amazonaws.com`,
      }
    );
    new route53.ARecord(this, "IoTDataARecord", {
      zone: hostedZone,
      recordName: iotDataEndpoint + ".",
      target: route53.RecordTarget.fromAlias(
        new targets.InterfaceVpcEndpointTarget(iotDataVpcEndpoint)
      ),
    });
    new route53.ARecord(this, "IoTCredARecord", {
      zone: hostedZone,
      recordName: iotCredEndpoint + ".",
      target: route53.RecordTarget.fromAlias(
        new targets.InterfaceVpcEndpointTarget(iotCredVpcEndpoint)
      ),
    });

    // VPC Endpoint for ssm
    vpc.addInterfaceEndpoint("VpcEndpointForSSM", {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      privateDnsEnabled: true,
      securityGroups: [sg],
      subnets: { subnets },
    });

    // VPC Endpoint for ssm messages
    vpc.addInterfaceEndpoint("VpcEndpointForSSMMessages", {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      privateDnsEnabled: true,
      securityGroups: [sg],
      subnets: { subnets },
    });

    // VPC Endpoint for ec2 messages
    vpc.addInterfaceEndpoint("VpcEndpointForEC2Messages", {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      privateDnsEnabled: true,
      securityGroups: [sg],
      subnets: { subnets },
    });
  }

  private getIoTEndpointPrefix(endpointType: string) {
    return new cr.AwsCustomResource(this, `IoTEndpoint-${endpointType}`, {
      onCreate: {
        service: "Iot",
        action: "describeEndpoint",
        physicalResourceId:
          cr.PhysicalResourceId.fromResponse("endpointAddress"),
        parameters: {
          endpointType: endpointType,
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    }).getResponseField("endpointAddress");
  }
}
