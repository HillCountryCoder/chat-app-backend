# Chat Application Deployment Guide

This guide provides step-by-step instructions for deploying the Chat Application backend to AWS using CDK.

## Prerequisites

- [Node.js](https://nodejs.org/) (v14.x or higher)
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured
- [AWS CDK](https://aws.amazon.com/cdk/) installed (`npm install -g aws-cdk`)
- Docker installed locally for building container images
- MongoDB Atlas account with a database cluster
- Redis database (from Vercel marketplace or other provider)

## Prepare Environment Variables

Before deploying, you need to ensure your MongoDB and Redis connection information is securely stored in AWS Secrets Manager.

### Create Required Secrets in AWS Secrets Manager

1. MongoDB connection string:

   ```bash
   aws secretsmanager create-secret \
     --name mongodb-url-development \
     --description "MongoDB connection string for development" \
     --secret-string '{"url":"YOUR_MONGODB_CONNECTION_STRING"}'
   ```

2. Redis connection string:
   ```bash
   aws secretsmanager create-secret \
     --name redis-url-development \
     --description "Redis connection string for development" \
     --secret-string '{"url":"YOUR_REDIS_CONNECTION_STRING"}'
   ```

For production, create the same secrets with `-production` suffix.

## CDK Deployment Steps

### Step 1: Initial Deployment (ECR Repository Only)

The first deployment creates only the ECR repository, which we'll need to push our Docker image to.

```bash
# Navigate to the CDK directory
cd cdk_chat

# Install dependencies
npm install

# Bootstrap CDK (if not already done)
cdk bootstrap

# Deploy only ECR repository
SKIP_FARGATE=true STAGE=development cdk deploy --require-approval never
```

### Step 2: Build and Push Docker Image

After creating the ECR repository, build and push your Docker image:

```bash
# Navigate back to the project root
cd ..

# Get the ECR repository URI from CDK output
export ECR_REPO=$(aws cloudformation describe-stacks --stack-name ChatBackendStack-development --query "Stacks[0].Outputs[?ExportName=='ECRRepositoryChatBackendAppURI-development'].OutputValue" --output text)

# Authenticate Docker to ECR
aws ecr get-login-password --region $(aws configure get region) | docker login --username AWS --password-stdin $ECR_REPO

# Build and tag the Docker image
docker build -t $ECR_REPO:latest .
 
OR

docker build --platform linux/amd64 -t $ECR_REPO:latest .
docker push $ECR_REPO:latest

# Push the image to ECR
docker push $ECR_REPO:latest

```

Note: for some reason if docker push does not work we can try the ECR-REPO value directly

### Step 3: Complete Deployment

Now deploy the full stack including the Fargate service:

```bash
# Navigate back to the CDK directory
cd cdk_chat

# Deploy the complete stack
STAGE=development cdk deploy --require-approval never
```

### Step 4: Verify Deployment

After successful deployment, you should be able to access your API through the provided Load Balancer DNS:

```bash
# Get the Load Balancer DNS
export ALB_DNS=$(aws cloudformation describe-stacks --stack-name ChatBackendStack-development --query "Stacks[0].Outputs[?ExportName=='LoadBalancerDNS-development'].OutputValue" --output text)

# Test the health endpoint
curl http://$ALB_DNS/health
```

## Updating Your Application

When you make changes to your application, follow these steps to deploy the updates:

1. Build and push a new Docker image:

   ```bash
   docker build -t $ECR_REPO:latest .
   docker push $ECR_REPO:latest
   ```

2. Force a new deployment of your ECS service:
   ```bash
   aws ecs update-service --cluster chat-backend-cluster-development --service chat-backend-service-development --force-new-deployment
   ```

## Monitoring

You can monitor your ECS services, tasks, and CloudWatch logs through the AWS Console.

### CloudWatch Logs

```bash
# Get the log group name
export LOG_GROUP_NAME="/aws/ecs/chat-backend"

# View recent logs
aws logs get-log-events --log-group-name $LOG_GROUP_NAME --log-stream-name $(aws logs describe-log-streams --log-group-name $LOG_GROUP_NAME --order-by LastEventTime --descending --limit 1 --query 'logStreams[0].logStreamName' --output text)
```

## Security Notes

For security best practices in production:

1. **JWT Secret**: In production, consider using AWS Secrets Manager for JWT secrets instead of hardcoding them.

2. **Connection Strings**: Always use Secret Manager for database connection strings which contain authentication credentials.

3. **SSL/TLS**: Consider adding HTTPS support for production deployments.

## Scaling Considerations for Production

For a production deployment, consider:

1. Using multiple Availability Zones for better reliability
2. Implementing Auto Scaling based on CPU/memory utilization
3. Adding CloudWatch Alarms for monitoring
4. Setting up a proper CI/CD pipeline for deployments

## Cleanup

To avoid unnecessary charges, you can destroy the entire stack when it's no longer needed:

```bash
cd cdk_chat
STAGE=development cdk destroy
```

> **Note**: This will delete all resources created by CDK, including the ECR repository, ECS services, and Load Balancer.
