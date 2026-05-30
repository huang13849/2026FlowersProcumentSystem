FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/index.html
COPY publish.html /usr/share/nginx/html/publish.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
