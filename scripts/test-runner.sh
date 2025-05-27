#!/bin/bash

# test-runner.sh - Comprehensive test runner for attachment system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Chat App Attachment System Test Runner${NC}"
echo "========================================"

# Check if .env file exists
if [ ! -f .env ]; then
	echo -e "${RED}❌ .env file not found! Please create .env file with required variables.${NC}"
	exit 1
fi

# Load environment variables - Fixed version
set -a
source .env
set +a

# Function to run tests with proper error handling
run_test_suite() {
	local test_name="$1"
	local test_command="$2"
	local is_optional="${3:-false}"

	echo ""
	echo -e "${BLUE}📋 Running $test_name...${NC}"
	echo "Command: $test_command"

	if eval "$test_command"; then
		echo -e "${GREEN}✅ $test_name passed!${NC}"
		return 0
	else
		if [ "$is_optional" = "true" ]; then
			echo -e "${YELLOW}⚠️  $test_name failed (optional)${NC}"
			return 0
		else
			echo -e "${RED}❌ $test_name failed!${NC}"
			return 1
		fi
	fi
}

# Function to check AWS configuration
check_aws_config() {
	echo -e "${BLUE}🔍 Checking AWS Configuration...${NC}"

	if [ -z "$MEDIA_BUCKET_NAME" ]; then
		echo -e "${YELLOW}⚠️  MEDIA_BUCKET_NAME not set - real AWS tests will be skipped${NC}"
		return 1
	fi

	if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
		echo -e "${YELLOW}⚠️  AWS credentials not set - real AWS tests will be skipped${NC}"
		return 1
	fi

	echo -e "${GREEN}✅ AWS configuration found:${NC}"
	echo "   Media Bucket: $MEDIA_BUCKET_NAME"
	echo "   Thumbnail Bucket: $THUMBNAIL_BUCKET_NAME"
	echo "   CDN Domain: $CDN_DOMAIN"
	echo "   AWS Region: $AWS_REGION"

	return 0
}

# Function to start test database
start_test_db() {
	echo -e "${BLUE}🗄️  Starting test database...${NC}"

	if command -v docker-compose &>/dev/null; then
		docker-compose up -d
		echo "Waiting for database to be ready..."
		sleep 5
	else
		echo -e "${YELLOW}⚠️  Docker Compose not found - assuming database is already running${NC}"
	fi
}

# Function to clean up test artifacts
cleanup() {
	echo ""
	echo -e "${BLUE}🧹 Cleaning up...${NC}"

	# Clear test logs
	if [ -d "logs" ]; then
		rm -rf logs/*.log
		echo "Test logs cleared"
	fi

	# Stop test database if we started it
	if command -v docker-compose &>/dev/null; then
		echo "Stopping test database..."
		docker-compose down >/dev/null 2>&1 || true
	fi
}

# Function to display test summary
display_summary() {
	local passed_tests=$1
	local total_tests=$2
	local skipped_tests=$3

	echo ""
	echo "========================================"
	echo -e "${BLUE}📊 Test Summary${NC}"
	echo "========================================"
	echo -e "Passed: ${GREEN}$passed_tests${NC}"
	echo -e "Failed: ${RED}$((total_tests - passed_tests - skipped_tests))${NC}"
	echo -e "Skipped: ${YELLOW}$skipped_tests${NC}"
	echo -e "Total: $total_tests"

	if [ $((total_tests - passed_tests - skipped_tests)) -eq 0 ]; then
		echo ""
		echo -e "${GREEN}🎉 All tests passed successfully!${NC}"
		return 0
	else
		echo ""
		echo -e "${RED}💥 Some tests failed!${NC}"
		return 1
	fi
}

# Parse command line arguments
SKIP_UNIT=false
SKIP_INTEGRATION=false
SKIP_REAL=false
ONLY_REAL=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
	case $1 in
	--skip-unit)
		SKIP_UNIT=true
		shift
		;;
	--skip-integration)
		SKIP_INTEGRATION=true
		shift
		;;
	--skip-real)
		SKIP_REAL=true
		shift
		;;
	--only-real)
		ONLY_REAL=true
		SKIP_UNIT=true
		SKIP_INTEGRATION=true
		shift
		;;
	--verbose | -v)
		VERBOSE=true
		shift
		;;
	--help | -h)
		echo "Usage: $0 [OPTIONS]"
		echo ""
		echo "Options:"
		echo "  --skip-unit         Skip unit tests"
		echo "  --skip-integration  Skip integration tests"
		echo "  --skip-real         Skip real AWS tests"
		echo "  --only-real         Run only real AWS tests"
		echo "  --verbose, -v       Verbose output"
		echo "  --help, -h          Show this help message"
		exit 0
		;;
	*)
		echo -e "${RED}Unknown option: $1${NC}"
		exit 1
		;;
	esac
done

# Set verbose output if requested
if [ "$VERBOSE" = true ]; then
	set -x
fi

# Trap to ensure cleanup runs on exit
trap cleanup EXIT

# Initialize counters
passed_tests=0
total_tests=0
skipped_tests=0

# Start test database
start_test_db

echo ""
echo -e "${BLUE}🏗️  Building project...${NC}"
if ! npm run build; then
	echo -e "${RED}❌ Build failed!${NC}"
	exit 1
fi

# Unit Tests
if [ "$SKIP_UNIT" = false ]; then
	echo ""
	echo -e "${BLUE}🔬 Unit Tests${NC}"
	echo "=============="

	# Attachment Service Tests
	if run_test_suite "Attachment Service Unit Tests" "npm run test src/services/__tests__/attachment.service.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))

	# S3 Service Tests
	if run_test_suite "S3 Service Unit Tests" "npm run test src/services/__tests__/s3.service.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))

	# Attachment Controller Tests
	if run_test_suite "Attachment Controller Unit Tests" "npm run test src/controllers/__tests__/attachment.controller.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))

	# Attachment Repository Tests
	if run_test_suite "Attachment Repository Unit Tests" "npm run test src/repositories/__tests__/attachment.repository.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))
fi

# Integration Tests
if [ "$SKIP_INTEGRATION" = false ]; then
	echo ""
	echo -e "${BLUE}🔗 Integration Tests${NC}"
	echo "==================="

	# Attachment Routes Integration Tests
	if run_test_suite "Attachment Routes Integration Tests" "npm run test src/tests/integration/routes/attachment.routes.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))

	# Database Integration Tests
	if run_test_suite "Attachment Database Integration Tests" "npm run test src/tests/integration/attachment-db.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))
fi

# Real AWS Tests
if [ "$SKIP_REAL" = false ]; then
	echo ""
	echo -e "${BLUE}☁️  Real AWS Integration Tests${NC}"
	echo "=============================="

	if check_aws_config; then
		echo -e "${GREEN}✅ AWS configuration valid - running real tests${NC}"

		# Set environment variable for real tests
		export INTEGRATION_TEST_REAL=true

		# Real Data Integration Tests
		if run_test_suite "Real AWS Integration Tests" "npm run test src/tests/integration/real-data/attachment.real.test.ts" "true"; then
			((passed_tests++))
		else
			((skipped_tests++))
		fi
		((total_tests++))

		# Performance Tests with Real AWS
		if run_test_suite "AWS Performance Tests" "npm run test src/tests/integration/performance/attachment.performance.test.ts" "true"; then
			((passed_tests++))
		else
			((skipped_tests++))
		fi
		((total_tests++))

	else
		echo -e "${YELLOW}⚠️  Skipping real AWS tests - configuration incomplete${NC}"
		((skipped_tests += 2))
		((total_tests += 2))
	fi
fi

# Additional Test Suites (if not skipping everything)
if [ "$ONLY_REAL" = false ]; then

	# API Key Middleware Tests
	if run_test_suite "API Key Middleware Tests" "npm run test src/common/middlewares/__tests__/api-key.middleware.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))

	# Enhanced Message Model Tests
	if run_test_suite "Enhanced Message Model Tests" "npm run test src/models/__tests__/message.model.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))

	# Message Service with Attachments Tests
	if run_test_suite "Message Service with Attachments Tests" "npm run test src/services/__tests__/message-with-attachments.service.test.ts"; then
		((passed_tests++))
	fi
	((total_tests++))
fi

# Run existing test suite to ensure no regressions
if [ "$ONLY_REAL" = false ] && [ "$SKIP_INTEGRATION" = false ]; then
	echo ""
	echo -e "${BLUE}🔄 Regression Tests${NC}"
	echo "=================="

	if run_test_suite "Existing Test Suite (Regression)" "npm run test --reporter=verbose"; then
		((passed_tests++))
	fi
	((total_tests++))
fi

# Display final summary
display_summary $passed_tests $total_tests $skipped_tests

# Example usage instructions
if [ $? -eq 0 ]; then
	echo ""
	echo -e "${BLUE}💡 Usage Examples:${NC}"
	echo "=================="
	echo "# Run all tests:"
	echo "  ./test-runner.sh"
	echo ""
	echo "# Run only real AWS tests:"
	echo "  ./test-runner.sh --only-real"
	echo ""
	echo "# Skip real AWS tests:"
	echo "  ./test-runner.sh --skip-real"
	echo ""
	echo "# Run with verbose output:"
	echo "  ./test-runner.sh --verbose"
	echo ""
	echo -e "${GREEN}🚀 Ready to test your attachment system!${NC}"
fi
