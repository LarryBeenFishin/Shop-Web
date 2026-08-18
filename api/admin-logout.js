const { clearCookie } = require('./_auth');
module.exports = async function handler(req,res){
  res.setHeader('Set-Cookie',clearCookie());
  return res.status(200).json({status:'success'});
};
