// カーリルAPI app key
var appkey = UserProperties.getProperty('CALIL_API_KEY');

function gas_log_output_(logs) {
  var userEmail = Session.getActiveUser().getEmail();
  var id = UserProperties.getProperty('SHEETID_LOGGING');
  var spreadSheet = SpreadsheetApp.openById(id);  

  logs.unshift(userEmail);
  logs.unshift(new Date());
  
  spreadSheet.getSheetByName('log').appendRow(logs);
}

function doGet(e) {
  var logStr = "";
  var token = "unknown";
  
  if (e.parameter!=undefined){
    if ( e.parameter.person != undefined ){
      switch (e.parameter.person){
        case "ME":
          token = UserProperties.getProperty('LINENOTIFY_MYSELF');
          logStr = "ME:";
          break;
        case "HER":
          token = UserProperties.getProperty('LINENOTIFY_PARTNER');
          logStr = "HER:";
          break;
      }
      
      logStr = logStr+e.parameter.book+"を検索";
      gas_log_output_(["BookSearcher",logStr]);
      var result = main(e.parameter.book);
      sendHttpPost(result.text + result.url, token);
      Speech.speech(result.text);
    }
  }else{
    return showform(UiApp.createApplication());  
  }
}

function main(book){
  var title = book.replace(/\s+/g, "");;
  var scriptProperties = PropertiesService.getScriptProperties();
  var libraId = scriptProperties.getProperty('LIBRA_ID');
  var info = getBookInfo(title);
  
  if( info.title == undefined ){ return { "text": "「"+title+"」に該当する本が見つかりませんでした", "url":"" } }
  
  var libraresult = getBookInfoInLibrary(info.isbn, libraId)
  Logger.log("libraresult(0): "+libraresult);
  var result = JSON.parse(libraresult);

  var str = "";
  var url = "";
  
  for(i=0; i<10 & result["continue"] != 0; i++ ){
    Logger.log("polling...");
    Utilities.sleep(3000);
    var r = UrlFetchApp.fetch('http://api.calil.jp/check?appkey='+appkey+'&callback=no&session=' + result.session);
    libraresult = r.getContentText();
    Logger.log("libraresult(n): "+libraresult);
    result = JSON.parse(libraresult);
  }
  
  if(result["continue"] == 0){
    if (result.books[info.isbn][libraId].libkey) {
      var list = result.books[info.isbn][libraId].libkey;
      if( Object.keys(list).length != 0 ){
        for(one in list){
          str = str + "、" + one + "にて" + list[one];
        }
        str = info.title + "は"+str+"です。";
        
        if(result.books[info.isbn][libraId].reserveurl ){
          url = shortenUrl(result.books[info.isbn][libraId].reserveurl);
        }
      }
    }
  }else{
    str = "検索に時間が掛かり失敗しました"; 
  }
  
  if( str == "" ){
      str = info.title + "は蔵書されていません";  
  }
  Logger.log("text:" + str);
  
  return {'text': str, 'url': url};
}

function checkLibraSystemId(){
  var r = UrlFetchApp.fetch('http://api.calil.jp/library?appkey='+appkey+'&geocode=xxxxx,xxxxxx&limit=10', {muteHttpExceptions:true });
  Logger.log(r.getResponseCode());
  Logger.log(r.getContentText());
}

function validation_amazonsearch(){
    //503を結構返すのでスリープループを実装
    
    Logger.log(getBookInfo("鬼童"));
}

function getBookInfoInLibrary(isbn, libraId){  
  var url = 'http://api.calil.jp/check?appkey='+appkey+'&callback=no&isbn='+isbn+'&systemid=' + libraId;
  var r = UrlFetchApp.fetch(url);
  return r.getContentText();
}

function getAmazonBookInfo(searchTitle){
  // AmazonAPI Keys
  var accessKey = UserProperties.getProperty('AMAZONAPI_ACCESSKEY');
  var secretKey = UserProperties.getProperty('AMAZONAPI_SECRETKEY');
  var associateID = UserProperties.getProperty('AMAZONAPI_ASSOCIATEID');

  var u = "http://ecs.amazonaws.jp/onca/xml?";
  var o = {
    Service:"AWSECommerceService",
    Version:"2011-08-01",
    AssociateTag:associateID,
    Operation:"ItemSearch",
    SearchIndex:"Books",
    //Title:searchTitle,
    Keywords:searchTitle,
    Timestamp:new Date().toISOString(),
    AWSAccessKeyId:accessKey,
    ResponseGroup:"ItemAttributes"
  };

  var a = Object.keys(o).sort();
  a = a.map(function(key){
    return key +"="+encodeURIComponent(o[key]);
  });

  var s = "GET" + "\n" + "ecs.amazonaws.jp" + "\n" + "/onca/xml" + "\n" + a.join("&");
  var x = Utilities.base64Encode(Utilities.computeHmacSha256Signature(s, secretKey));
  var z = u + a.join("&") + "&Signature=" + encodeURIComponent(x);
  
  var r = UrlFetchApp.fetch(z, { muteHttpExceptions:true });
  return r;
}

function getBookInfo(searchTitle){
  var info = {};
  var r = getAmazonBookInfo(searchTitle);
  for( i=0; i<10 & r.getResponseCode()==503; i++ ){ 
    Utilities.sleep(1000);
    r = getAmazonBookInfo(searchTitle);
  }
  if(r.getResponseCode()==503){ return false; }

  var x = XmlService.parse(r.getContentText());  
  var name = x.getRootElement().getNamespace();
  var items = x.getRootElement().getChild('Items',name).getChildren('Item',name);
  
  for(var i=0;i<items.length;i++){
    if(items[i].getType() == XmlService.ContentTypes.ELEMENT){
      // Kindleの一致を回避
      if( items[i].asElement().getChild('ItemAttributes',name).getChild('ISBN',name) != undefined ){
         info.isbn = items[i].getChild('ItemAttributes',name).getChild('ISBN',name).getText();
         info.title = items[i].getChild('ItemAttributes',name).getChild('Title',name).getText();
         break;
      }
    }
  }
  return info;
}

function sendHttpPost(message,token){  
  var options =
   {
     "method"  : "post",
     "payload" : "message=" + encodeURIComponent(message),
     "headers" : {"Authorization" : "Bearer "+ token}
   };
   UrlFetchApp.fetch("https://notify-api.line.me/api/notify",options);
}

function shortenUrl(long_url) {
  var url = UrlShortener.Url.insert({
    longUrl: long_url
  });
  return url.id;
}
