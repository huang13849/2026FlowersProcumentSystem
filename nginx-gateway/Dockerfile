FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/index.html
COPY publish.html /usr/share/nginx/html/publish.html
COPY ai.html /usr/share/nginx/html/ai.html
COPY order.html /usr/share/nginx/html/order.html
COPY price /usr/share/nginx/html/price
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
