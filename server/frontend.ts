import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Serve an already-built local frontend; never expose source files or .env. */
export function mountFrontend(app: express.Express, outputDirectory = resolve('dist')) {
  app.all(/^\/api(?:\/|$)/, (_request,response) => {
    response.status(404).json({error:{code:'route_not_found',message:'API 路徑不存在。'}});
  });
  app.use(express.static(outputDirectory,{dotfiles:'deny',index:'index.html'}));
  app.get(/.*/, (_request,response,next) => {
    const index = resolve(outputDirectory,'index.html');
    if(!existsSync(index)) {
      response.status(503).type('text/plain').send('Motion Atlas 前端尚未建置。請先執行 npm run build，再使用 npm start。開發模式請執行 npm run dev，並開啟 http://127.0.0.1:3016。');
      return;
    }
    response.sendFile(index,error=>{if(error)next(error);});
  });
}
