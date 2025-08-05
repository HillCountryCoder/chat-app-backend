import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { Construct } from "constructs";
import { Stage } from "../stage";
import { Duration } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
export interface ChatBackendStackProps extends cdk.StackProps {
  stage: Stage;
}

export class ChatBackendStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly ecrRepository: ecr.Repository;
  public readonly networkLoadBalancer: elbv2.NetworkLoadBalancer;
  public readonly mediaBucket: s3.Bucket;
  public readonly thumbnailBucket: s3.Bucket;
  public readonly mediaDistribution: cloudfront.Distribution;
  private logGroup: logs.LogGroup;
  constructor(scope: Construct, id: string, props: ChatBackendStackProps) {
    super(scope, id, props);
    const isProduction = props.stage === Stage.PRODUCTION;
    const appName = "ChatBackendApp";
    this.logGroup = new logs.LogGroup(this, "ChatBackendLogGroup", {
      logGroupName: `/ecs/chat-backend-${props.stage}`,
      retention: isProduction
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    // Create a VPC - COST REDUCTION: Single AZ, no NAT Gateways
    const vpc = new ec2.Vpc(this, "ChatBackendVPC", {
      maxAzs: 1,
      natGateways: 0,
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
      containerInsights: false,
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
          maxImageCount: isProduction ? 10 : 3,
          description: "keep only recent images",
        },
      ],
    });

    // Create S3 bucket for media uploads
    this.mediaBucket = new s3.Bucket(this, "MediaBucket", {
      bucketName: `chat-media-${props.stage}-${this.account}`,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
      // Simplified lifecycle - no quarantine needed
      lifecycleRules: [
        {
          // Clean up incomplete multipart uploads after 1 day
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create S3 bucket for thumbnails
    this.thumbnailBucket = new s3.Bucket(this, "ThumbnailBucket", {
      bucketName: `chat-thumbnails-${props.stage}-${this.account}`,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create CloudFront distribution for media delivery

    const oacMediaBucket = new cloudfront.S3OriginAccessControl(
      this,
      "ChatMediaOAC",
      {
        signing: cloudfront.Signing.SIGV4_ALWAYS,
        originAccessControlName: "ChatMediaBucketOAC",
      },
    );

    const oacThumbnailBucket = new cloudfront.S3OriginAccessControl(
      this,
      "ChatThumbnailOAC",
      {
        signing: cloudfront.Signing.SIGV4_ALWAYS,
        originAccessControlName: "ChatThumbnailBucketOAC",
      },
    );
    this.mediaDistribution = new cloudfront.Distribution(this, "ChatMediaCDN", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(
          this.mediaBucket,
          {
            originAccessControl: oacMediaBucket,
          },
        ),
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/thumbnails/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.thumbnailBucket,
            {
              originAccessControl: oacThumbnailBucket,
            },
          ),
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
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
        memoryLimitMiB: 512,
        cpu: 256,
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
          CORS_ORIGIN:
            "https://chat-app-frontend-one-coral.vercel.app,http://localhost:3000",
          // Add media environment variables
          MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
          THUMBNAIL_BUCKET_NAME: this.thumbnailBucket.bucketName,
          CDN_DOMAIN: this.mediaDistribution.distributionDomainName,
          AWS_REGION: this.region,
        },
        secrets: {
          MONGODB_URI: ecs.Secret.fromSecretsManager(mongoDbSecret, "url"),
          REDIS_URI: ecs.Secret.fromSecretsManager(redisSecret, "url"),
        },
        logging: ecs.LogDrivers.awsLogs({
          logGroup: this.logGroup,
          streamPrefix: "chat-backend",
        }),
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
        assignPublicIp: true,
        desiredCount: 1,
        serviceName: `chat-backend-service-${props.stage}`,
        securityGroups: [serviceSG],
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE_SPOT",
            weight: 1,
          },
        ],
      });

      // Grant S3 permissions to ECS task
      this.mediaBucket.grantReadWrite(this.ecsService.taskDefinition.taskRole);
      this.thumbnailBucket.grantReadWrite(
        this.ecsService.taskDefinition.taskRole,
      );

      // Create a Network Load Balancer
      this.networkLoadBalancer = new elbv2.NetworkLoadBalancer(
        this,
        "ChatBackendNLB",
        {
          vpc,
          internetFacing: true,
          loadBalancerName: `chat-backend-nlb-${props.stage}`,
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
          interval: cdk.Duration.minutes(5),
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

    // Media infrastructure outputs
    new cdk.CfnOutput(this, "MediaBucketName", {
      value: this.mediaBucket.bucketName,
      description: "Media bucket name",
      exportName: `MediaBucket-${props.stage}`,
    });

    new cdk.CfnOutput(this, "ThumbnailBucketName", {
      value: this.thumbnailBucket.bucketName,
      description: "Thumbnail bucket name",
      exportName: `ThumbnailBucket-${props.stage}`,
    });

    new cdk.CfnOutput(this, "CDNDomain", {
      value: this.mediaDistribution.distributionDomainName,
      description: "CloudFront distribution domain name",
      exportName: `CDNDomain-${props.stage}`,
    });
  }
}
