import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";
import { Stage } from "../stage";

export interface ChatBackendStackProps extends cdk.StackProps {
  stage: Stage;
}

export class ChatBackendStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly ecrRepository: ecr.Repository;
  public readonly networkLoadBalancer: elbv2.NetworkLoadBalancer;

  constructor(scope: Construct, id: string, props: ChatBackendStackProps) {
    super(scope, id, props);
    const isProduction = props.stage === Stage.PRODUCTION;
    const appName = "ChatBackendApp";

    // Create a VPC - COST REDUCTION: Single AZ, no NAT Gateways
    const vpc = new ec2.Vpc(this, "ChatBackendVPC", {
      maxAzs: 1, // COST REDUCTION: Using only one AZ
      natGateways: 0, // No NAT Gateways
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
      vpcName: `chat-backend-vpc-${props.stage}`,
    });
    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, "ChatBackendCluster", {
      vpc,
      containerInsights: false, // COST REDUCTION: Disable Container Insights
      clusterName: `chat-backend-cluster-${props.stage}`,
    });

    // Create an ECR repository
    this.ecrRepository = new ecr.Repository(this, "BackendRepo", {
      repositoryName: `chat-backend-repo-${props.stage}`,
      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: !isProduction,
      lifecycleRules: [
        {
          maxImageCount: isProduction ? 10 : 3, // COST REDUCTION: Keep fewer images
          description: "keep only recent images",
        },
      ],
    });

    // Reference existing secrets instead of creating new ones
    const mongoDbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "MongoDbSecret",
      `mongodb-url-${props.stage}`,
    );

    const redisSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "RedisSecret",
      `redis-url-${props.stage}`,
    );

    // Skip Fargate service creation in first deployment as it looks for empty ECR repository
    if (process.env.SKIP_FARGATE !== "true") {
      // Create a task definition
      const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
        memoryLimitMiB: 512, // Minimum viable memory
        cpu: 256, // Minimum viable CPU
      });

      // Add container to task definition
      const container = taskDefinition.addContainer("ChatBackendContainer", {
        image: ecs.ContainerImage.fromEcrRepository(
          this.ecrRepository,
          "latest",
        ),
        environment: {
          NODE_ENV: props.stage,
          PORT: "5000",
          JWT_SECRET: "itsasecretansakdbaskjdbaskjdbaskdbaskdbsakdsdaks",
          JWT_EXPIRES_IN: "1d",
          CORS_ORIGIN: "*", // Add CORS setting
        },
        secrets: {
          MONGODB_URI: ecs.Secret.fromSecretsManager(mongoDbSecret, "url"),
          REDIS_URI: ecs.Secret.fromSecretsManager(redisSecret, "url"),
        },
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: "chat-backend" }),
      });

      // Add port mapping
      container.addPortMappings({
        containerPort: 5000,
        hostPort: 5000,
        protocol: ecs.Protocol.TCP,
      });

      // Create a security group for the Fargate service
      const serviceSG = new ec2.SecurityGroup(this, "ServiceSecurityGroup", {
        vpc,
        description: "Security group for the Fargate service",
        allowAllOutbound: true,
      });

      // Allow inbound traffic on container port
      serviceSG.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(5000),
        "Allow incoming traffic to container port",
      );

      // Create the Fargate service
      this.ecsService = new ecs.FargateService(this, "ChatBackendService", {
        cluster,
        taskDefinition,
        assignPublicIp: true, // Required for public subnets without NAT
        desiredCount: 1, // Single task
        serviceName: `chat-backend-service-${props.stage}`,
        securityGroups: [serviceSG],
        // COST REDUCTION: Using Fargate Spot for ~70% cost savings
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE_SPOT",
            weight: 1,
          },
        ],
      });

      // Create a Network Load Balancer
      this.networkLoadBalancer = new elbv2.NetworkLoadBalancer(
        this,
        "ChatBackendNLB",
        {
          vpc,
          internetFacing: true,
          loadBalancerName: `chat-backend-nlb-${props.stage}`,
          // COST REDUCTION: Deploy in same AZ as the service
          vpcSubnets: { subnets: vpc.publicSubnets },
        },
      );

      // Create a target group for the service
      const targetGroup = new elbv2.NetworkTargetGroup(this, "TargetGroup", {
        vpc,
        port: 5000,
        protocol: elbv2.Protocol.TCP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          enabled: true,
          port: "5000",
          protocol: elbv2.Protocol.HTTP,
          path: "/health",
          interval: cdk.Duration.seconds(60), // Reduced frequency
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
        },
      });

      // Register targets
      targetGroup.addTarget(this.ecsService);

      // Create HTTP listener
      const httpListener = this.networkLoadBalancer.addListener("Listener", {
        port: 80,
        protocol: elbv2.Protocol.TCP,
        defaultTargetGroups: [targetGroup],
      });

      // If you have an ACM certificate, uncomment this to add HTTPS

      // Import your ACM certificate (already created in ACM)
      const certificate = acm.Certificate.fromCertificateArn(
        this,
        "ChatApiCertificate",
        "arn:aws:acm:us-east-1:519076116465:certificate/4454dd30-6ad3-451f-8762-77f717c21251",
      );

      // Add HTTPS listener
      const httpsListener = this.networkLoadBalancer.addListener(
        "HttpsListener",
        {
          port: 443,
          protocol: elbv2.Protocol.TLS,
          certificates: [certificate],
          defaultTargetGroups: [targetGroup],
        },
      );

      // Output the HTTPS listener ARN
      new cdk.CfnOutput(this, "HttpsListenerARN", {
        value: httpsListener.listenerArn,
        description: `Network Load Balancer HTTPS Listener ARN for ${appName}`,
        exportName: `HttpsListener${appName}ARN-${props.stage}`,
      });

      // Output the NLB DNS name
      new cdk.CfnOutput(this, "LoadBalancerDNS", {
        value: this.networkLoadBalancer.loadBalancerDnsName,
        description: `Network Load Balancer DNS Name for ${appName}`,
        exportName: `LoadBalancerDNS${appName}-${props.stage}`,
      });

      new cdk.CfnOutput(this, "HttpListenerARN", {
        value: httpListener.listenerArn,
        description: `Network Load Balancer HTTP Listener ARN for ${appName}`,
        exportName: `HttpListener${appName}ARN-${props.stage}`,
      });
    }

    // Output the ECR repository URI
    new cdk.CfnOutput(this, `ECRRepository${appName}URI`, {
      value: this.ecrRepository.repositoryUri,
      description: `ECR Repository URI ${appName}`,
      exportName: `ECRRepository${appName}URI-${props.stage}`,
    });
  }
}
