pipeline {
    agent any
    environment {
        REGISTRY = "100.76.15.64:5001"
        NAMESPACE = "supply-chain"
        KUBECONFIG = "/home/jenkins/k3s.yaml"
    }
    stages {
        stage('Clone') {
            steps {
                checkout scm
            }
        }
        stage('Unit Test') {
            steps {
                echo 'Running unit tests...'
                // Implement service-specific tests
                sh 'find . -name "package.json" -exec npm test {} \\; || true'
            }
        }
        stage('Supplier Geo System Test') {
            steps {
                echo 'Running supplier geo unification system test...'
                dir('supplier-service') {
                    sh '''
                        npm install --silent --no-audit --no-fund
                        # 测试库使用同一 Mongo，独立 db supply_chain_test
                        TEST_URI=$(echo "$MONGODB_URI" | sed 's#/supply_chain?#/supply_chain_test?#' | sed 's#readPreference=secondaryPreferred#readPreference=primary#')
                        TEST_MONGODB_URI="$TEST_URI" node --test tests/system/
                    '''
                }
            }
        }
        stage('Build & Push Images') {
            steps {
                script {
                    // Build all 7 core services
                    def services = [
                        "product-service",
                        "supplier-service",
                        "shop-service",
                        "order-service",
                        "api-gateway",
                        "scene-service",
                        "contract-service",
                        "purchase-list-service",
                        "user-management-service",
                        "seller-binding-service"
                    ]
                    for (service in services) {
                        docker.build("${REGISTRY}/supply-chain/${service}:latest", "-f ${service}/Dockerfile ${service}/")
                        docker.push("${REGISTRY}/supply-chain/${service}:latest")
                    }
                }
            }
        }
        stage('Deploy to k3s') {
            steps {
                echo 'Deploying to k3s...'
                sh 'export KUBECONFIG=$KUBECONFIG && kubectl apply -f k8s/supply-chain/'
                sh 'export KUBECONFIG=$KUBECONFIG && kubectl -n $NAMESPACE rollout restart deployment'
            }
        }
        stage('System Test') {
            steps {
                echo 'Running system health checks...'
                script {
                    def ports = [3001, 3002, 3004, 3006, 3007, 3008, 3012]
                    for (port in ports) {
                        sh "curl -m 5 -f http://100.96.54.109:${port}/api/health"
                    }
                }
            }
        }
    }
    post {
        success {
            echo '✅ Deployment completed successfully!'
        }
        failure {
            echo '❌ Deployment failed!'
        }
    }
}
