'use strict';
const slug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^a-z0-9_-]+/gi,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'contest';
module.exports={slug};
