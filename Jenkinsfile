pipeline {
  agent { label 'docker-build' }
  environment {
    SERVICE    = "shop-management-service"
    NAMESPACE  = "supply-chain"
    NODE_PORT  = "31004"
    IMAGE      = "100.76.15.64:5001/supply-chain/shop-management-service"
    BUILD_PATH = "shop-service"
    SERVICE_HOST = "100.96.54.109"
    GITEA_URL  = "http://admin:***@1987921@100.76.15.64:13000/admin/supply-chain-platform.git"
    REGISTRY_HOST = "100.76.15.64:5001"
    REGISTRY_NAMESPACE = "supply-chain"
  }
  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse --short HEAD > .git/HEAD_SHA'
      }
    }
    stage('Build & Push in dind (xspt05)') {
      steps {
        container('dind') {
          sh '''
            set -euo pipefail
            SHA=$(cat .git/HEAD_SHA)
            TAG="${SERVICE}-jenkins-$(date +%Y%m%d%H%M%S)-${SHA}"
            IMG="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/${SERVICE}:${TAG}"
            echo "[1/4] git clone in dind"
            cd /home/jenkins/agent
            if [ ! -d repo ]; then
              git clone "${GITEA_URL}" repo
            else
              cd repo && git fetch origin && git reset --hard origin/main && cd ..
            fi
            cd repo
            if [ -n "${BUILD_PATH}" ]; then cd "${BUILD_PATH}"; fi
            if [ ! -f Dockerfile ]; then
              echo "ERROR: Dockerfile not found in $(pwd)" >&2
              ls -la
              exit 11
            fi
            echo "[2/4] docker build (in dind container)"
            docker build --platform linux/amd64 -t "${IMG}" .
            echo "[3/4] docker push to ${REGISTRY_HOST}"
            docker push "${IMG}"
            echo "[4/4] kubectl rollout"
            TAG="${TAG}" IMG="${IMG}" kubectl -n ${NAMESPACE} set image deployment/${SERVICE} ${SERVICE}="${IMG}"
            TAG="${TAG}" IMG="${IMG}" kubectl -n ${NAMESPACE} rollout status deployment/${SERVICE} --timeout=180s
            echo "${TAG}" | tee /tmp/last_tag.txt
            echo "BUILD_OK image=${IMG}"
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
    success { echo "shop-management-service deployed OK (dind on xspt05)" }
    failure { echo "shop-management-service build/deploy failed" }
  }
}
