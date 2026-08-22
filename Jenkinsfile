pipeline {
  agent {
    kubernetes {
      yaml '''apiVersion: v1
kind: Pod
metadata:
  labels:
    jenkins: agent
spec:
  nodeSelector:
    ci-build-enabled: "true"
  serviceAccountName: jenkins-agent
  containers:
  - name: jnlp
    image: 100.76.15.64:5001/jenkins/inbound-agent:latest-jdk17
    args: ['$(JENKINS_SECRET)', '$(JENKINS_NAME)']
    tty: true
  - name: dind
    image: 100.76.15.64:5001/library/docker:27-dind-amd64
    args: ['--host=unix:///var/run/docker.sock', '--insecure-registry=100.76.15.64:5001', '--storage-driver=vfs']
    securityContext:
      privileged: true
    volumeMounts:
    - name: docker-storage
      mountPath: /var/lib/docker
  - name: kubectl
    image: 100.76.15.64:5001/k8s/kubectl:latest
    command: ['cat']
    tty: true
  volumes:
  - name: docker-storage
    emptyDir: {}
'''
    }
  }
  environment {
    SERVICE = "shop-management-service"
    NAMESPACE = "supply-chain"
    NODE_PORT = "31004"
    BUILD_PATH = "shop-service"
    SERVICE_HOST = "100.96.54.109"
    GITEA_URL = "http://admin:038cfc283d4055cc5331ee04131cabef8c123be5@100.76.15.64:13000/admin/supply-chain-platform.git"
    REGISTRY_HOST = "100.76.15.64:5001"
    REGISTRY_NAMESPACE = "supply-chain"
  }
  stages {
    stage('Checkout') { steps { checkout scm; sh 'git rev-parse --short HEAD > .git/HEAD_SHA' } }
    stage('Build & Push in dind') {
      steps {
        container('dind') {
          sh '''
            set -euo pipefail
            SHA=$(cat .git/HEAD_SHA)
            TAG="${SERVICE}-jenkins-$(date +%Y%m%d%H%M%S)-${SHA}"
            IMG="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/${SERVICE}:${TAG}"
            cd /home/jenkins/agent
            if [ ! -d repo ]; then git clone "${GITEA_URL}" repo
            else cd repo && git fetch origin && git reset --hard origin/main && cd ..; fi
            cd repo
            if [ -n "${BUILD_PATH}" ]; then cd "${BUILD_PATH}"; fi
            [ ! -f Dockerfile ] && { echo "ERROR: Dockerfile not found in $(pwd)" >&2; ls -la; exit 11; }
            docker build --platform linux/amd64 -t "${IMG}" .
            docker push "${IMG}"
            echo "${IMG}" > /home/jenkins/agent/last_img
            echo "BUILD_OK image=${IMG}"
          '''
        }
      }
    }
    stage('Deploy via kubectl sidecar') {
      steps {
        container('kubectl') {
          sh '''
            set -euo pipefail
            IMG=$(cat /tmp/last_img)
            echo "Deploying ${IMG}"
            kubectl -n ${NAMESPACE} set image deployment/${SERVICE} ${SERVICE}="${IMG}"
            kubectl -n ${NAMESPACE} rollout status deployment/${SERVICE} --timeout=180s
          '''
        }
      }
    }
    stage('Verify endpoints') {
      steps {
        sh '''
          set -euo pipefail
          for u in "/" "/api/health" "/api/shops" "/api/shops?platform=huaxiang"; do
            code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://${SERVICE_HOST}:${NODE_PORT}${u}" || echo ERR)
            echo "${code} http://${SERVICE_HOST}:${NODE_PORT}${u}"
            [ "${code}" = "200" ] || exit 20
          done
        '''
      }
    }
  }
  post {
    success { echo "shop-management-service deployed OK" }
    failure { echo "shop-management-service build/deploy failed" }
  }
}
