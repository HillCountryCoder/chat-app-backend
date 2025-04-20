import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";
import { Stage } from "../stage";

export interface ChatBackendStackProps extends cdk.StackProps {
  stage: Stage;
}

export class ChatBackendStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly ecrRepository: ecr.Repository;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ChatBackendStackProps) {
    super(scope, id, props);
    const isProduction = props.stage === Stage.PRODUCTION;

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

    // Create secrets for MongoDB and Redis URLs
    const mongoDbSecret = new secretsmanager.Secret(this, "MongoDbSecret", {
      secretName: `mongodb-url-${props.stage}`,
      description: "MongoDB Atlas connection string",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ url: "" }),
        generateStringKey: "url",
      },
    });

    const redisSecret = new secretsmanager.Secret(this, "RedisSecret", {
      secretName: `redis-url-${props.stage}`,
      description: "Redis connection string",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ url: "" }),
        generateStringKey: "url",
      },
    });

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

      // Create an Application Load Balancer
      this.loadBalancer = new elbv2.ApplicationLoadBalancer(
        this,
        "ChatBackendALB",
        {
          vpc,
          internetFacing: true,
          loadBalancerName: `chat-backend-alb-${props.stage}`,
          // COST REDUCTION: Deploy in same AZ as the service
          vpcSubnets: { subnets: vpc.publicSubnets },
        },
      );

      // Create a target group for the service
      const targetGroup = new elbv2.ApplicationTargetGroup(
        this,
        "TargetGroup",
        {
          vpc,
          port: 5000,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targetType: elbv2.TargetType.IP,
          healthCheck: {
            enabled: true,
            path: "/health",
            interval: cdk.Duration.seconds(60), // Reduced frequency
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 2,
          },
        },
      );

      // Register targets
      targetGroup.addTarget(this.ecsService);

      // Create a listener
      const httpListener = this.loadBalancer.addListener("Listener", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultTargetGroups: [targetGroup],
      });

      // Output the ALB DNS name
      new cdk.CfnOutput(this, "LoadBalancerDNS", {
        value: this.loadBalancer.loadBalancerDnsName,
        description: "Application Load Balancer DNS Name",
        exportName: `LoadBalancerDNS-${props.stage}`,
      });

      new cdk.CfnOutput(this, "HttpListenerARN", {
        value: httpListener.listenerArn,
        description: "Load Balancer HTTP Listener ARN",
        exportName: `HttpListenerARN-${props.stage}`,
      });
    }

    // Output the ECR repository URI
    new cdk.CfnOutput(this, "ECRRepositoryURI", {
      value: this.ecrRepository.repositoryUri,
      description: "ECR Repository URI",
      exportName: `ECRRepositoryURI-${props.stage}`,
    });
  }
}
