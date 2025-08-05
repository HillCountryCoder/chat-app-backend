# Chat App Docker Deployment Automation Guide

This guide provides instructions for automating the Docker deployment process for your Chat App backend application.

## Local Development Automation

The provided deployment scripts automate your Docker build and deployment workflow:

- `deploy.sh` - Full-featured script for local testing and deployment
- `deploy-to-ecr.sh` - Simplified script focused on ECR pushing

### Setup Instructions

1. Save both scripts to the root of your Chat App project
2. Make them executable:
   ```bash
   chmod +x deploy.sh deploy-to-ecr.sh
   ```
3. Ensure AWS CLI is installed and configured with appropriate permissions
4. Verify your CloudFormation stack is deployed with the correct naming

### Configuration Details

Your Chat App uses the following configuration:
- **AWS Region**: `us-east-1`
- **AWS Account**: `519076116465`
- **Container Port**: `5000`
- **Health Endpoint**: `/health`
- **CloudFormation Stack**: `ChatBackendStack-{environment}`
- **ECR Repository**: `chat-backend-repo-{environment}`
- **ECS Cluster**: `chat-backend-cluster-{environment}`
- **ECS Service**: `chat-backend-service-{environment}`

## Usage Examples

### Local Development with deploy.sh

#### Build the Docker image only:
```bash
./deploy.sh --build
```

#### Build and run locally with health checks:
```bash
# For development environment
./deploy.sh --run --env development

# For production environment  
./deploy.sh --run --env production
```

#### Test existing local container:
```bash
./deploy.sh --test --env development
```

#### Build, push to ECR, and optionally deploy to ECS:
```bash
# For development
./deploy.sh --push --env development

# For production
./deploy.sh --push --env production
```

### ECR-Only Deployment with deploy-to-ecr.sh

#### Build and push to development ECR:
```bash
./deploy-to-ecr.sh development
```

#### Build and push to production ECR:
```bash
./deploy-to-ecr.sh production
```

## Features

### deploy.sh Features:
- **Comprehensive local testing**: Builds and runs containers locally with health checks
- **Multi-environment support**: Handles both development and production configurations
- **Health monitoring**: Performs 30 retry attempts with detailed health check responses
- **Version tracking**: Creates timestamped image tags for version history
- **ECS deployment integration**: Optional ECS service updates with stability checks
- **Environment file support**: Automatically uses `.env` or `.env.production` files
- **Clear status feedback**: Color-coded output and detailed error messages
- **Container management**: Automatically handles existing container cleanup

### deploy-to-ecr.sh Features:
- **Simplified ECR workflow**: Focused solely on building and pushing images
- **Version tagging**: Creates both `latest` and timestamped tags
- **ECS integration**: Optional service updates with stability waiting
- **Robust error handling**: Clear success/failure indicators

## Environment Configuration

### Development Environment
The script looks for `.env` file for development settings. Your current `.env` includes:
```bash
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://admin:password@localhost:27017/chat-app?authSource=admin
# ... other development settings
```

### Production Environment
For production deployments, create a `.env.production` file with production-specific settings.

## Health Check Integration

Both scripts include comprehensive health checking using your `/health` endpoint, which monitors:
- Server status
- MongoDB connection
- Redis connection
- Service uptime
- Environment configuration

The health check performs up to 30 retry attempts with 2-second intervals, providing detailed response information for debugging.

## CloudFormation Integration

The scripts automatically retrieve ECR repository URLs from your CloudFormation stack outputs:
- **Stack Name**: `ChatBackendStack-{environment}`
- **ECR Output**: `ECRRepositoryChatBackendAppURI-{environment}`
- **Load Balancer Output**: `LoadBalancerDNSChatBackendApp-{environment}`

## Complete Deployment Workflow

### Typical Development Workflow:

1. **Local Development and Testing**:
   ```bash
   # Build and test locally first
   ./deploy.sh --run --env development
   
   # Check health endpoint
   curl http://localhost:5000/health
   ```

2. **Development Deployment**:
   ```bash
   # Deploy to development environment
   ./deploy.sh --push --env development
   ```

3. **Production Deployment**:
   ```bash
   # Deploy to production
   ./deploy.sh --push --env production
   ```

### Quick ECR-Only Workflow:
```bash
# For rapid iteration without local testing
./deploy-to-ecr.sh development
```

## Troubleshooting

### Common Issues and Solutions:

1. **ECR Repository Detection Fails**:
   - Verify AWS credentials: `aws sts get-caller-identity`
   - Check CloudFormation stack exists: `aws cloudformation describe-stacks --stack-name ChatBackendStack-development`
   - Ensure ECR repository output is correctly named in your CDK stack

2. **Health Check Fails**:
   - View container logs: `docker logs chat-backend-service`
   - Check if MongoDB/Redis are accessible
   - Verify environment variables are properly set
   - Test health endpoint manually: `curl http://localhost:5000/health`

3. **Container Won't Start Locally**:
   - Check Docker daemon is running
   - Verify port 5000 is not already in use: `lsof -i :5000`
   - Review environment file paths and variables

4. **ECS Deployment Issues**:
   - Check ECS service configuration:
     ```bash
     aws ecs describe-services --cluster chat-backend-cluster-development --services chat-backend-service-development
     ```
   - Verify ECS task definition and container configuration
   - Check CloudWatch logs for container startup issues

5. **Image Build Failures**:
   - Ensure Dockerfile exists in project root
   - Check Docker build context and file permissions
   - Verify all required files are not in .dockerignore

### Debug Commands:
```bash
# Check running containers
docker ps -a

# View container logs
docker logs chat-backend-service --follow

# Check container health
docker exec chat-backend-service curl http://localhost:5000/health

# Inspect container environment
docker exec chat-backend-service env

# Check AWS resources
aws cloudformation describe-stacks --stack-name ChatBackendStack-development
aws ecr describe-repositories --repository-names chat-backend-repo-development
aws ecs describe-services --cluste
