#!/bin/bash

# Docker deployment script for Chat Application
# This script builds, tests locally, and deploys to AWS ECR

set -e # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print messages
log() {
	echo -e "${GREEN}[INFO]${NC} $1"
}

error() {
	echo -e "${RED}[ERROR]${NC} $1"
	exit 1
}

warning() {
	echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check required commands
check_commands() {
	log "Checking required commands..."

	if ! command -v docker &>/dev/null; then
		error "Docker is not installed."
	fi

	if ! command -v aws &>/dev/null; then
		error "AWS CLI is not installed."
	fi
}

# Test Docker image with isolated services
test_isolated() {
	log "Testing Docker image with isolated services..."

	# Create a network for test containers
	docker network create chat-test-network 2>/dev/null || true

	# Stop any existing test containers
	docker rm -f mongodb-test redis-test chat-backend-test 2>/dev/null || true

	# Start MongoDB
	log "Starting MongoDB..."
	docker run -d \
		--name mongodb-test \
		--network chat-test-network \
		-e MONGO_INITDB_ROOT_USERNAME=admin \
		-e MONGO_INITDB_ROOT_PASSWORD=password \
		mongo:latest

	# Start Redis
	log "Starting Redis..."
	docker run -d \
		--name redis-test \
		--network chat-test-network \
		redis:alpine

	# Wait for services to be ready
	log "Waiting for services to start..."
	sleep 10

	# Run application container
	log "Starting application container..."
	docker run -d \
		--name chat-backend-test \
		--network chat-test-network \
		-p 5001:5000 \
		-e NODE_ENV=development \
		chat-backend:local

	# Wait for app to start
	log "Waiting for application to be ready..."
	sleep 15

	# Test health endpoint
	log "Testing health endpoint..."
	if curl -s http://localhost:5001/health | grep -q "up"; then
		log "Health check passed ✓"
	else
		warning "Health check failed. Checking container logs..."
		docker logs --tail 50 chat-backend-test
		error "Health check failed"
	fi

	# Show container logs
	log "Container logs:"
	docker logs --tail 20 chat-backend-test

	# Cleanup
	log "Cleaning up test containers..."
	docker stop chat-backend-test mongodb-test redis-test
	docker rm chat-backend-test mongodb-test redis-test
	docker network rm chat-test-network

	log "Isolated testing completed successfully"
}

# Check if MongoDB and Redis are accessible
check_services() {
	log "Checking if MongoDB and Redis are accessible..."

	# Check MongoDB
	if ! nc -zv localhost 27017 2>/dev/null; then
		warning "MongoDB is not accessible on localhost:27017"
		warning "Make sure MongoDB is running with: npm run db:up"
		return 1
	fi

	# Check Redis
	if ! nc -zv localhost 6379 2>/dev/null; then
		warning "Redis is not accessible on localhost:6379"
		warning "Make sure Redis is running with: npm run db:up"
		return 1
	fi

	log "MongoDB and Redis are accessible"
	return 0
}

# Build Docker image
build_image() {
	log "Building Docker image..."

	# Build multi-platform image if needed
	if [[ "$OSTYPE" == "darwin"* ]] && [[ "$(uname -m)" == "arm64" ]]; then
		log "Building for linux/amd64 platform (Apple Silicon detected)..."
		docker build --platform linux/amd64 -t chat-backend:local .
	else
		docker build -t chat-backend:local .
	fi

	log "Docker image built successfully"
}

# Test Docker image locally
test_local() {
	log "Testing Docker image locally..."

	# Stop and remove existing container if it exists
	docker rm -f chat-backend-test 2>/dev/null || true

	# Run container locally
	log "Starting container..."
	docker run -d \
		--name chat-backend-test \
		-p 5001:5000 \
		-e NODE_ENV=development \
		chat-backend:local

	# Wait for container to start
	log "Waiting for container to be ready..."
	sleep 10

	# Check if container is running
	if ! docker ps | grep -q chat-backend-test; then
		error "Container failed to start. Check logs with: docker logs chat-backend-test"
	fi

	# Test health endpoint
	log "Testing health endpoint..."
	if curl -s http://localhost:5001/health | grep -q "up"; then
		log "Health check passed ✓"
	else
		warning "Health check failed. Checking container logs..."
		docker logs --tail 50 chat-backend-test
		error "Health check failed"
	fi

	# Check container logs
	log "Container logs:"
	docker logs --tail 20 chat-backend-test

	# Stop container
	log "Stopping test container..."
	docker stop chat-backend-test
	docker rm chat-backend-test

	log "Local testing completed successfully"
}

# Get ECR repository URI
get_ecr_uri() {

	STAGE=${1:-development}
	STACK_NAME="ChatBackendStack-${STAGE}"

	# Get ECR URI from CloudFormation stack
	ECR_REPO=$(aws cloudformation describe-stacks \
		--stack-name $STACK_NAME \
		--query "Stacks[0].Outputs[?ExportName=='ECRRepositoryChatBackendAppURI-${STAGE}'].OutputValue" \
		--output text)
	if [ -z "$ECR_REPO" ]; then
		warning "CloudFormation stack not found. Trying to get ECR directly..."

		# Try to get ECR repository by name
		ECR_REPO=$(aws ecr describe-repositories \
			--repository-names "chat-backend-app-${STAGE}" \
			--query 'repositories[0].repositoryUri' \
			--output text)
	fi

	if [ -z "$ECR_REPO" ] || [ "$ECR_REPO" == "None" ]; then
		error "ECR repository not found. Have you run 'cdk deploy' yet?"
	fi

	echo $ECR_REPO
}

# Authenticate Docker to ECR
auth_ecr() {
	log "Authenticating Docker to ECR..."

	ECR_REPO=$1
	REGION=$(aws configure get region)
	log "$ECR_REPO"
	# Get the registry URI (without repository name)
	REGISTRY=$(echo $ECR_REPO | cut -d'/' -f1)

	# Authenticate
	aws ecr get-login-password --region $REGION |
		docker login --username AWS --password-stdin $REGISTRY

	log "Docker authenticated to ECR"
}

# Deploy to ECR
deploy_to_ecr() {
	STAGE=${1:-development}

	log "Deploying to ECR for stage: $STAGE"
	# Get ECR URI
	ECR_REPO=$(get_ecr_uri $STAGE)
	log "ECR Repository: $ECR_REPO"
	# Authenticate to ECR
	auth_ecr $ECR_REPO

	# Tag and push image
	log "Tagging image for ECR..."
	docker tag chat-backend:local $ECR_REPO:latest
	docker tag chat-backend:local $ECR_REPO:$(date +%Y%m%d%H%M%S)

	log "Pushing image to ECR..."
	docker push $ECR_REPO:latest
	docker push $ECR_REPO:$(date +%Y%m%d%H%M%S)

	log "Image pushed successfully to ECR"
}

# Force ECS update
update_ecs() {
	STAGE=${1:-development}

	log "Forcing ECS service update..."

	CLUSTER_NAME="chat-backend-cluster-${STAGE}"
	SERVICE_NAME="chat-backend-service-${STAGE}"

	aws ecs update-service \
		--cluster $CLUSTER_NAME \
		--service $SERVICE_NAME \
		--force-new-deployment \
		--query 'service.taskDefinition' \
		--output text

	log "ECS service update initiated"
}

# Main function
main() {
	case "${1:-help}" in
	"build")
		check_commands
		build_image
		;;
	"test")
		check_commands
		if check_services; then
			test_local
		else
			error "Please ensure MongoDB and Redis are running before testing"
		fi
		;;
	"test-isolated")
		check_commands
		test_isolated
		;;
	"build-test")
		check_commands
		build_image
		test_isolated
		;;
	"build-test-local")
		check_commands
		build_image
		if check_services; then
			test_local
		else
			error "Please ensure MongoDB and Redis are running before testing"
		fi
		;;
	"deploy")
		STAGE=${2:-development}
		check_commands
		deploy_to_ecr $STAGE
		update_ecs $STAGE
		;;
	"all")
		STAGE=${2:-development}
		check_commands
		build_image
		test_local
		deploy_to_ecr $STAGE
		update_ecs $STAGE
		;;
	"get-uri")
		STAGE=${2:-development}
		get_ecr_uri $STAGE
		;;
	*)
		echo "Usage: $0 {build|test|test-isolated|build-test|build-test-local|deploy|all|get-uri} [stage]"
		echo ""
		echo "Commands:"
		echo "  build             - Build Docker image locally"
		echo "  test              - Test Docker image locally (requires local MongoDB/Redis)"
		echo "  test-isolated     - Test with isolated MongoDB/Redis containers"
		echo "  build-test        - Build and test with isolated services"
		echo "  build-test-local  - Build and test with local MongoDB/Redis"
		echo "  deploy            - Deploy image to ECR and update ECS"
		echo "  all               - Build, test, and deploy"
		echo "  get-uri           - Get ECR repository URI"
		echo ""
		echo "Options:"
		echo "  stage             - Deployment stage (development/production), defaults to development"
		echo ""
		echo "Examples:"
		echo "  $0 build                  # Build Docker image"
		echo "  $0 build-test             # Build and test with isolated services"
		echo "  $0 test-isolated          # Test with isolated services"
		echo "  $0 all development        # Full deployment to development"
		echo "  $0 deploy production      # Deploy to production ECR"
		;;
	esac
}

# Run main function
main "$@"
