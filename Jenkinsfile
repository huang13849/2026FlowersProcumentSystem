pipeline {
  agent any
  environment {
    REGISTRY   = "100.76.15.64:5001"
    IMAGE_BASE = "${REGISTRY}/supply-chain/shop-management-service"
    SERVICE    = "shop-management-service"
    NAMESPACE  = "supply-chain"
    NODE_PORT  = "31004"
    JUMP_USER = "huangfra-ubun-master"
    JUMP_HOST = "100.96.54.109"
    BUILD_USER = "dell"
    BUILD_HOST = "100.113.60.71"
    BUILD_WORKDIR = "/home/dell/shop-management-service"
    GITEA_URL  = "http://admin:Hy%401987921@100.76.15.64:13000/admin/supply-chain-platform.git"
    GIT_BRANCH = "main"
  }
  stages {
    stage('Checkout') { steps { checkout scm; sh 'git rev-parse --short HEAD > .git/HEAD_SHA' } }
    stage('Build on office2-wsl') {
      steps {
        sh '''
          set -euo pipefail
          SHA=$(cat .git/HEAD_SHA)
          TAG="${SERVICE}-jenkins-$(date +%Y%m%d%H%M%S)-${SHA}"
          IMG="${IMAGE_BASE}:${TAG}"
          echo "[1/5] jumpbox -> build ${BUILD_USER}@${BUILD_HOST}"

          # 直接从 Jenkinsfile workspace 拿 build script, scp 到 jumpbox, 再 scp 到 xspt05
          scp -O -o StrictHostKeyChecking=no ./build_office2wsl.sh ${JUMP_USER}@${JUMP_HOST}:/tmp/build_office2wsl.sh
          ssh -o StrictHostKeyChecking=no ${JUMP_USER}@${JUMP_HOST} "scp -O -o StrictHostKeyChecking=no /tmp/build_office2wsl.sh ${BUILD_USER}@${BUILD_HOST}:/tmp/build_office2wsl.sh"

          echo "[2/5] ssh jumpbox -> ssh xspt05 -> execute build (env vars via ssh)"
          ssh -o StrictHostKeyChecking=no ${JUMP_USER}@${JUMP_HOST} "ssh -o StrictHostKeyChecking=no ${BUILD_USER}@${BUILD_HOST} 'GITEA_URL=${GITEA_URL} REPO_DIR=${BUILD_WORKDIR} IMAGE=${IMG} bash /tmp/build_office2wsl.sh'"
          echo "[3/5] deploy ${IMG} to k3s"
          kubectl -n ${NAMESPACE} set image deployment/${SERVICE} ${SERVICE}=${IMG}
          kubectl -n ${NAMESPACE} rollout status deployment/${SERVICE} --timeout=180s
          echo "TAG_FILE: ${TAG}" | tee /tmp/last_tag.txt
        '''
      }
    }
    stage('Verify endpoints') {
      steps {
        sh '''
          set -euo pipefail
          for u in http://127.0.0.1:${NODE_PORT}/ http://127.0.0.1:${NODE_PORT}/api/health http://127.0.0.1:${NODE_PORT}/api/shops "http://127.0.0.1:${NODE_PORT}/api/shops?platform=huaxiang"; do
            code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u" || echo ERR)
            echo "$code $u"
            [ "$code" = "200" ] || exit 20
          done
        '''
      }
    }
    stage('Verify deployed image') {
      steps {
        sh 'kubectl -n ${NAMESPACE} get deploy ${SERVICE} -o jsonpath=\'{.spec.template.spec.containers[0].image}{\\"\\\\n\\"}\''
      }
    }
  }
  post {
    success { echo "shop-management-service deployed OK from office2-wsl build" }
    failure { echo "shop-management-service build/deploy failed" }
  }
}
