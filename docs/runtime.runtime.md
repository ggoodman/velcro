<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@velcro/runtime](./runtime.md) &gt; [runtime](./runtime.runtime.md)

## runtime variable

<b>Signature:</b>

```typescript
runtime = "(function(Velcro){var e=function(e,r,t){this.runtime=e,this.id=r,this.importMap=t,this.module={exports:{}},this.require=this.runtime.createRequire(this)},r=function(){function r(r){this.dependents={},this.modules={},this.defs=r.defs,this.root=new e(this,\"velcro:/root\",{}),Object.defineProperty(this,\"require\",{enumerable:!0,value:this.root.require.bind(this.root)})}return r.prototype.createRequire=function(r){var t=this;function i(e){return t.resolveSpecAgainstImportMap(e,r)}return Object.assign((function(o){var n=i(o),s=t.modules[n];if(!s){var u=t.defs[n];if(!u)throw new Error(\"Unable to locate module '\"+n+\"' from '\"+r.id);var a=u[0],p=u[1];s=new e(t,n,p),t.modules[n]=s;var d=n.split(\"/\"),l=d.pop()||o,c=d.join(\"/\");a.call(s.module.exports,s.module,s.module.exports,s.require.bind(s),c,l)}return(t.dependents[n]=t.dependents[n]||[]).push(r),s.module.exports}),{resolve:i})},r.prototype.inject=function(r,t){var i=new e(this,r,Object.create(null));return i.module.exports=t,this.modules[r]=i,i},r.prototype.invalidate=function(e){for(var r=e.slice(),t=!1;r.length;){var i=r.shift();t=delete this.modules[i]||t;var o=this.dependents[i];if(Array.isArray(o))for(var n=0;n<o.length;n++)r.push(o[n].id)}return t},r.prototype.resolveSpecAgainstImportMap=function(e,r){var t=r.importMap;if(!t.scopes)return e;var i=t.scopes[r.id];if(!i)return e;var o=i[e];return o||e},r.create=function(t){return t.runtime||(t.runtime=new r(t.registry)),t.Module=e,t.Runtime=r,t.runtime},r}();Velcro.runtime=r.create(Velcro);})"
```
