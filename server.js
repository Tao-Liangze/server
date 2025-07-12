const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');


// 确保videos目录存在
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('已创建videos目录:', videosDir);
}

// 创建 express 应用和 HTTP 服务器
const app = express();
const server = http.createServer(app);
// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ noServer: true });
const { Writable } = require('stream');

let webClients = [];  // 存储网页客户端的连接
let appClients = [];  // 存储手机 APP 客户端的连接
// 存储每个客户端的视频数据

let clientId = 0;
let currentVideoName = null; // 存储当前视频名称
let currentSavePath = null; // 存储当前保存路径
// 处理 WebSocket 连接
wss.on('connection', (ws, req) => {
  const isWebClient = req.headers['sec-websocket-protocol'] === 'web';  // 判断是网页客户端还是 APP 客户端
  let videoDatas = [];
  if (isWebClient) {
    webClients.push(ws);  // 网页客户端连接
  } else {
    appClients.push(ws);  // 手机 APP 客户端连接

    videoDatas = {
      videoData: [],
      isRecording: false,
      outputFile: '' // 将在开始录制时设置
    };
    clientId++;
  }

  // 监听消息
  ws.on('message', (message) => {
    // console.log('收到消息:', message);
    const data = JSON.parse(message);
    // console.log('收到消息:',data);
    // 如果是网页客户端，广播消息到所有手机 APP 客户端
    if (isWebClient) {
      // 如果消息包含视频名称和保存路径，则保存它们
      if (data.type === "success" && data.videoName) {
        currentVideoName = data.videoName;
        console.log('收到视频名称:', currentVideoName);
        
        // 处理保存路径
        if (data.savePath) {
          currentSavePath = data.savePath;
          console.log('收到保存路径:', currentSavePath);
          
          // 确保保存路径存在
          if (!fs.existsSync(currentSavePath)) {
            try {
              fs.mkdirSync(currentSavePath, { recursive: true });
              console.log('已创建保存目录:', currentSavePath);
            } catch (err) {
              console.error('创建保存目录失败:', err);
              // 如果创建目录失败，回退到默认路径
              currentSavePath = null;
            }
          }
        } else {
          currentSavePath = null;
        }
      }
      
      appClients.forEach((appWs) => {
        appWs.send(JSON.stringify(data));
        console.log("send message")
      });
    }else{
                  // 处理视频数据片段
      if (data.type === 'calibr_intri' && data.session === 'calibr_video') {
        if (videoDatas.isRecording) {
          console.log(`接收视频片段：${clientId}`);
          console.log('single data'+data.video.length);
          const base64Data = data.video.replace(/^data:video\/mp4;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          // 将 base64 编码的 video 数据保存到数组中
          videoDatas.videoData.push(buffer);
          console.log('videoDatas'+videoDatas.videoData.length);
        }
      }
      else if (data.type === 'calibr_intri' && data.session === 'begin') {
                if (videoDatas.isRecording) {
                    console.log('视频录制已开始，无法重复开始');
                    return;
                }
                videoDatas.isRecording = true;
                // 在开始录制时重新设置outputFile路径，使用最新的currentVideoName值和保存路径
                const fileName = currentVideoName ? `${currentVideoName}.mp4` : `output_video_${clientId%10}.mp4`;
                
                // 确定保存路径：使用用户指定的路径或默认路径
                let saveDirectory;
                
                if (currentSavePath && fs.existsSync(currentSavePath)) {
                    saveDirectory = currentSavePath;
                } else {
                    saveDirectory = path.join(__dirname, 'videos');
                    // 确保默认的videos目录存在
                    if (!fs.existsSync(saveDirectory)) {
                        fs.mkdirSync(saveDirectory, { recursive: true });
                    }
                }
                
                videoDatas.outputFile = path.join(saveDirectory, fileName);
                console.log(`视频录制开始：${clientId}，输出文件：${videoDatas.outputFile}`);

                // 清空之前的数据，准备新的视频数据
                videoDatas.videoData = [];
            }
            // 判断视频结束标志
      else if (data.type === 'calibr_intri' && data.session === 'end') {
                if (!videoDatas.isRecording) {
                    console.log('视频录制未开始，无法结束');
                    return;
                }
                videoDatas.isRecording = false;
                console.log(`视频录制结束：${clientId}`);
                // 保存视频数据到文件
                saveVideoData(videoDatas.videoData,videoDatas.outputFile);

                // 清空视频数据
                videoDatas.videoData = [];
            }
      else if(data.type === 'mac_address'){
          console.log('手机参数:',data);
      }



    }
  });

  // 监听连接关闭
  ws.on('close', () => {
    if (isWebClient) {
      webClients = webClients.filter(client => client !== ws);
    } else {
      appClients = appClients.filter(client => client !== ws);
    }
  });
});

// 设置静态文件目录
app.use(express.static('public'));

// 提供一个 HTTP 路由来返回当前连接数
app.get('/connections', (req, res) => {
  res.json({ webClients: webClients.length, appClients: appClients.length });
});

// 处理 WebSocket 升级
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

// 启动 HTTP 服务器
server.listen(5000, () => {
  console.log('WebSocket 服务器运行中: ws://localhost:5000');
});

function saveVideoData(session, filePath) {
     // 拼接所有的 Base64 数据块
    // const fullBase64 = session.join('');
    // console.log('fullBase64'+fullBase64.length);
    const videoBuffer = Buffer.concat(session);  // 合并所有数据块
    // 去掉 Base64 前缀
    // const base64Data = fullBase64.replace(/^data:video\/mp4;base64,/, '');
    // const videoBuffer = Buffer.from(base64Data, 'base64');
    console.log('videoBuffer'+videoBuffer.length);
    fs.writeFile(filePath, videoBuffer, (err) => {
        if (err) {
            console.error('保存视频文件失败:', err);
        } else {
            console.log(`视频保存成功: ${filePath}`);
            
            // 向所有Web客户端广播视频保存成功的消息
            webClients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'videoSaved',
                        fileName: path.basename(filePath),
                        filePath: filePath,
                        size: videoBuffer.length
                    }));
                }
            });
        }
    });
}