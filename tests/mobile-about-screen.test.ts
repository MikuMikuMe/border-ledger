import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';

const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');
const {create,act}=require('react-test-renderer');

vi.mock('../mobile/node_modules/react-native/index.js',()=>({
  ScrollView:'ScrollView',
  StatusBar:'StatusBar',
  StyleSheet:{create:(styles:unknown)=>styles},
  View:'View',
}));
vi.mock('../mobile/node_modules/react-native-safe-area-context/lib/commonjs/index.js',()=>({SafeAreaView:'SafeAreaView'}));
vi.mock('@/components/ui/text',()=>({Text:'Text'}));
vi.mock('@/features/auth/presentationPolicy',()=>({
  DARK_TEXT_COLORS:{accent:'#EEF1E8'},
  statusBarStyle:()=> 'dark-content',
}));

const {AboutScreen}=await import('../mobile/src/screens/AboutScreen');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;

const flattenStyle=(style:unknown):Record<string,unknown>=>{
  if(Array.isArray(style))return Object.assign({},...style.map(flattenStyle));
  return style&&typeof style==='object'?style as Record<string,unknown>:{};
};

const render=()=>{
  let tree:any;
  act(()=>{tree=create(React.createElement(AboutScreen,{dark:false}));});
  return tree;
};

const textStyle=(tree:any,label:string)=>{
  const node=tree.root.findAll((item:any)=>item.type==='Text'&&item.props.children===label)[0];
  return flattenStyle(node.props.style);
};

describe('About screen light theme typography',()=>{
  it('keeps section headings and body copy at their intended hierarchy',()=>{
    const tree=render();
    expect(textStyle(tree,'Designed around consent')).toMatchObject({
      color:'#18201F',fontFamily:'Newsreader',fontSize:23,lineHeight:28,marginTop:18,
    });
    expect(textStyle(tree,'Every screen is a React Native view. Secure sign-in, financial records, capture, bank connections, and files continue through the app’s Android-protected services.')).toMatchObject({
      color:'#4F5C56',fontFamily:'DMSans',fontSize:15,lineHeight:23,marginTop:9,
    });
  });
});
