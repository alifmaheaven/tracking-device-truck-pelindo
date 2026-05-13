FROM nginx:alpine

# Salin folder dist hasil build dari laptop ke folder nginx
COPY dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
