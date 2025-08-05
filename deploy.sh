#!/bin/bash

# Docker deployment automation script for Chat App Backend
# Usage: 
#   ./deploy.sh --build                          # Build only
#   ./deploy.sh --run --env development          # Build and run locally with health check
#   ./deploy.sh --push --env development         # Build, push to ECR, and optionally deploy to ECS
#   ./deploy.sh --test --env development         # Test existing local container

# Configuration
AWS_REGION="us-east-1"
IMAGE_NAME="chat-backend-app"
CONTAINER_NAME="chat-backend-service"
HEALTH_ENDPOINT="/health"
CONTAINER_PORT=5000
LOCAL_PORT=5000

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to show usage
show_usage() {
    echo -e "${BLUE}Chat App Backend Deployment Script${NC}"
    echo ""
    echo "Usage:"
    echo "  ./deploy.sh --build                          Build Docker image only"
    echo "  ./deploy.sh --run --env ENVIRONMENT          Build and run locally with health check"
    echo "  ./deploy.sh --push --env ENVIRONMENT         Build, push to ECR, and optionally deploy to ECS"
    echo "  ./deploy.sh --test --env ENVIRONMENT         Test existing local container"
    echo ""
    echo "Environments: development, production"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh --build"
    echo "  ./deploy.sh --run --env development"
    echo "  ./deploy.sh --push --env production"
    exit 1
}

# Function to check if a command was successful
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
    else
        echo -e "${RED}✗ $1${NC}"
        exit 1
    fi
}

# Function to build Docker image
build_image() {
    echo -e "${YELLOW}Building Docker image...${NC}"
    docker build --platform linux/amd64 -t $IMAGE_NAME .
    check_status "Docker image build"
}

# Function to test container health
test_health() {
    local max_attempts=30
    local attempt=1
    
    echo -e "${YELLOW}Testing container health...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "http://localhost:$LOCAL_PORT$HEALTH_ENDPOINT" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Health check passed (attempt $attempt)${NC}"
            
            # Show health response
            echo -e "${BLUE}Health check response:${NC}"
            curl -s "http://localhost:$LOCAL_PORT$HEALTH_ENDPOINT" | jq . 2>/dev/null || curl -s "http://localhost:$LOCAL_PORT$HEALTH_ENDPOINT"
            return 0
        fi
        
        echo -e "${YELLOW}Health check attempt $attempt failed, retrying in 2 seconds...${NC}"
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}✗ Health check failed after $max_attempts attempts${NC}"
    echo -e "${YELLOW}Container logs:${NC}"
    docker logs $CONTAINER_NAME --tail 20
    exit 1
}

# Function to run container locally
run_locally() {
    local environment=$1
    
    # Stop and remove existing container if running
    if docker ps -q -f name=$CONTAINER_NAME | grep -q .; then
        echo -e "${YELLOW}Stopping existing container...${NC}"
        docker stop $CONTAINER_NAME > /dev/null
        docker rm $CONTAINER_NAME > /dev/null
    fi
    
    # Create .env file path
    local env_file=".env"
    if [ "$environment" = "production" ]; then
        env_file=".env.production"
    fi
    
    # Check if env file exists
    if [ ! -f "$env_file" ]; then
        echo -e "${YELLOW}Warning: $env_file not found, using environment variables${NC}"
        env_args=""
    else
        env_args="--env-file $env_file"
    fi
    
    echo -e "${YELLOW}Starting container locally for $environment...${NC}"
    docker run -d \
        --name $CONTAINER_NAME \
        -p $LOCAL_PORT:$CONTAINER_PORT \
        $env_args \
        -e NODE_ENV=$environment \
        $IMAGE_NAME
    check_status "Container startup"
    
    # Test health
    test_health
}

# Function to push to ECR and optionally deploy to ECS
push_and_deploy() {
    local environment=$1
    
    # Get ECR repository URL from CloudFormation
    local stack_name="ChatBackendStack-$environment"
    echo -e "${YELLOW}Getting ECR repository URL from stack: $stack_name${NC}"
    
    local ecr_repo=$(aws cloudformation describe-stacks --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?ExportName=='ECRRepositoryChatBackendAppURI-$environment'].OutputValue" \
        --output text 2>/dev/null)
    
    if [ -z "$ecr_repo" ]; then
        echo -e "${RED}Error: Could not retrieve ECR repository URL from CloudFormation${NC}"
        echo -e "${YELLOW}Make sure your CloudFormation stack '$stack_name' exists and has the ECR repository output${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Using ECR repository: $ecr_repo${NC}"
    
    # Login to ECR
    echo -e "${YELLOW}Logging in to AWS ECR...${NC}"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $(echo $ecr_repo | cut -d'/' -f1)
    check_status "AWS ECR login"
    
    # Tag and push image
    local timestamp=$(date +"%Y%m%d-%H%M%S")
    local version_tag="${environment}-${timestamp}"
    
    echo -e "${YELLOW}Tagging image...${NC}"
    docker tag $IMAGE_NAME:latest $ecr_repo:latest
    docker tag $IMAGE_NAME:latest $ecr_repo:$version_tag
    check_status "Image tagging"
    
    echo -e "${YELLOW}Pushing to ECR...${NC}"
    docker push $ecr_repo:latest
    docker push $ecr_repo:$version_tag
    check_status "Image push to ECR"
    
    echo -e "${GREEN}Successfully pushed image with tags:${NC}"
    echo -e "${GREEN}  - latest${NC}"
    echo -e "${GREEN}  - $version_tag${NC}"
    
    # Option to deploy to ECS
    read -p "Do you want to update the ECS service? (y/n): " UPDATE_SERVICE
    if [[ $UPDATE_SERVICE == "y" ]]; then
        echo -e "${YELLOW}Updating ECS service...${NC}"
        aws ecs update-service \
            --cluster chat-backend-cluster-$environment \
            --service chat-backend-service-$environment \
            --force-new-deployment
        check_status "ECS service update"
        
        echo -e "${YELLOW}Waiting for service to become stable...${NC}"
        aws ecs wait services-stable \
            --cluster chat-backend-cluster-$environment \
            --services chat-backend-service-$environment
        check_status "ECS service stabilization"
        
        # Get load balancer DNS for verification
        local lb_dns=$(aws cloudformation describe-stacks --stack-name "$stack_name" \
            --query "Stacks[0].Outputs[?ExportName=='LoadBalancerDNSChatBackendApp-$environment'].OutputValue" \
            --output text 2>/dev/null)
        
        if [ ! -z "$lb_dns" ]; then
            echo -e "${GREEN}Service updated successfully!${NC}"
            echo -e "${BLUE}You can check the health endpoint at: http://$lb_dns/health${NC}"
        fi
    fi
}

# Function to test existing local container
test_existing() {
    if ! docker ps -q -f name=$CONTAINER_NAME | grep -q .; then
        echo -e "${RED}✗ Container '$CONTAINER_NAME' is not running${NC}"
        echo -e "${YELLOW}Use --run to start a new container${NC}"
        exit 1
    fi
    
    test_health
}

# Parse command line arguments
ACTION=""
ENVIRONMENT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --build)
            ACTION="build"
            shift
            ;;
        --run)
            ACTION="run"
            shift
            ;;
        --push)
            ACTION="push"
            shift
            ;;
        --test)
            ACTION="test"
            shift
            ;;
        --env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --help|-h)
            show_usage
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_usage
            ;;
    esac
done

# Validate arguments
if [ -z "$ACTION" ]; then
    echo -e "${RED}Error: No action specified${NC}"
    show_usage
fi

if [[ "$ACTION" == "run" || "$ACTION" == "push" || "$ACTION" == "test" ]]; then
    if [ -z "$ENVIRONMENT" ]; then
        echo -e "${RED}Error: Environment is required for --$ACTION${NC}"
        show_usage
    fi
    
    if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "production" ]]; then
        echo -e "${RED}Error: Environment must be 'development' or 'production'${NC}"
        show_usage
    fi
fi

# Execute based on action
case $ACTION in
    "build")
        echo -e "${BLUE}Chat App - Building Docker image${NC}"
        build_image
        echo -e "${GREEN}Build completed successfully!${NC}"
        ;;
    "run")
        echo -e "${BLUE}Chat App - Building and running locally for $ENVIRONMENT${NC}"
        build_image
        run_locally $ENVIRONMENT
        echo -e "${GREEN}Container is running successfully!${NC}"
        echo -e "${BLUE}Access your app at: http://localhost:$LOCAL_PORT${NC}"
        echo -e "${BLUE}Health check: http://localhost:$LOCAL_PORT$HEALTH_ENDPOINT${NC}"
        echo -e "${YELLOW}Use 'docker logs $CONTAINER_NAME' to view logs${NC}"
        echo -e "${YELLOW}Use 'docker stop $CONTAINER_NAME' to stop the container${NC}"
        ;;
    "push")
        echo -e "${BLUE}Chat App - Building, pushing to ECR, and deploying for $ENVIRONMENT${NC}"
        build_image
        push_and_deploy $ENVIRONMENT
        echo -e "${GREEN}Deployment completed successfully!${NC}"
        ;;
    "test")
        echo -e "${BLUE}Chat App - Testing existing container${NC}"
        test_existing
        echo -e "${GREEN}Container health test passed!${NC}"
        ;;
esac
