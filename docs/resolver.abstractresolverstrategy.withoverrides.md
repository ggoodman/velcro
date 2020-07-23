<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@velcro/resolver](./resolver.md) &gt; [AbstractResolverStrategy](./resolver.abstractresolverstrategy.md) &gt; [withOverrides](./resolver.abstractresolverstrategy.withoverrides.md)

## AbstractResolverStrategy.withOverrides() method

Create a new ResolverStrategy having one or more methods overridden.

You might use this if you want to override specific behaviour of another strategy without wanting to re-implement the whole strategy.

If you need to invoke an overridden method, the overridden strategy will be available on `this.parent`<!-- -->.

<b>Signature:</b>

```typescript
withOverrides(overrides: {
        [TMethodName in keyof ResolverStrategy]?: ResolverStrategy[TMethodName];
    }): ResolverStrategy;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  overrides | { \[TMethodName in keyof ResolverStrategy\]?: ResolverStrategy\[TMethodName\]; } | A map of ResolverStrategy methods that you would like to override |

<b>Returns:</b>

ResolverStrategy
